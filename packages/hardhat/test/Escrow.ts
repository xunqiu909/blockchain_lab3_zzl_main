import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);

async function deployFixture() {
  const [
    deployer,
    buyer,
    seller,
    arbiter,
    stranger,
  ] = await ethers.getSigners();

  const token = await ethers.deployContract("ZZLToken");

  await token.mint(
    buyer.address,
    ethers.parseUnits("100", 18)
  );

  const escrow = await ethers.deployContract(
    "Escrow",
    [arbiter.address]
  );

  const deadline = (await time.latest()) + 3600;

  return {
    token,
    escrow,
    deployer,
    buyer,
    seller,
    arbiter,
    stranger,
    deadline,
  };
}

describe("Escrow", function () {
  it("createOrder 记录订单并发出事件", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
    } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(buyer).createOrder(
        seller.address,
        await token.getAddress(),
        AMOUNT,
        deadline,
        "一本书"
      )
    )
      .to.emit(escrow, "OrderCreated")
      .withArgs(
        0,
        buyer.address,
        seller.address,
        await token.getAddress(),
        AMOUNT,
        deadline
      );

    const order = await escrow.getOrder(0);

    expect(order.buyer).to.equal(buyer.address);
    expect(order.seller).to.equal(seller.address);
    expect(order.amount).to.equal(AMOUNT);
    expect(order.status).to.equal(0n);
    expect(await escrow.orderCount()).to.equal(1n);
  });

  it("未 approve 时 deposit 失败", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
    } = await loadFixture(deployFixture);

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await expect(
      escrow.connect(buyer).deposit(0)
    ).to.be.revertedWith("insufficient allowance");
  });

  it("approve 后 deposit 成功，代币进入 Escrow，状态变为 Paid", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await expect(
      escrow.connect(buyer).deposit(0)
    )
      .to.emit(escrow, "OrderPaid")
      .withArgs(0);

    expect(
      await token.balanceOf(escrowAddress)
    ).to.equal(AMOUNT);

    const order = await escrow.getOrder(0);

    expect(order.status).to.equal(1n);
  });

  it("非买家调用 confirm 失败", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
      stranger,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await escrow.connect(buyer).deposit(0);

    await expect(
      escrow.connect(stranger).confirm(0)
    ).to.be.revertedWith(
      "Escrow: caller is not the buyer"
    );
  });

  it("confirm 后卖家收到代币，状态变为 Completed", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await escrow.connect(buyer).deposit(0);

    const sellerBalanceBefore =
      await token.balanceOf(seller.address);

    await expect(
      escrow.connect(buyer).confirm(0)
    )
      .to.emit(escrow, "OrderCompleted")
      .withArgs(0);

    const sellerBalanceAfter =
      await token.balanceOf(seller.address);

    expect(sellerBalanceAfter - sellerBalanceBefore)
      .to.equal(AMOUNT);

    const order = await escrow.getOrder(0);

    expect(order.status).to.equal(2n);

    expect(
      await token.balanceOf(escrowAddress)
    ).to.equal(0n);
  });

  it("deadline 之前 refund 失败，deadline 之后 refund 成功并退回买家", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      deadline,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await escrow.connect(buyer).deposit(0);

    await expect(
      escrow.connect(buyer).refund(0)
    ).to.be.revertedWith(
      "Escrow: deadline not reached"
    );

    const buyerBalanceBefore =
      await token.balanceOf(buyer.address);

    await time.increase(3600);

    await expect(
      escrow.connect(buyer).refund(0)
    )
      .to.emit(escrow, "OrderRefunded")
      .withArgs(0);

    const buyerBalanceAfter =
      await token.balanceOf(buyer.address);

    expect(buyerBalanceAfter - buyerBalanceBefore)
      .to.equal(AMOUNT);

    const order = await escrow.getOrder(0);

    expect(order.status).to.equal(3n);

    expect(
      await token.balanceOf(escrowAddress)
    ).to.equal(0n);
  });

  it("非仲裁人调用 resolve 失败", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      arbiter,
      deadline,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await escrow.connect(buyer).deposit(0);
    await escrow.connect(buyer).dispute(0);

    await expect(
      escrow.connect(seller).resolve(0, true)
    ).to.be.revertedWith(
      "Escrow: caller is not the arbiter"
    );
  });

  it("dispute 后仲裁人 resolve(false) 退款给买家，状态变为 Refunded", async function () {
    const {
      token,
      escrow,
      buyer,
      seller,
      arbiter,
      deadline,
    } = await loadFixture(deployFixture);

    const escrowAddress = await escrow.getAddress();

    await escrow.connect(buyer).createOrder(
      seller.address,
      await token.getAddress(),
      AMOUNT,
      deadline,
      "一本书"
    );

    await token.connect(buyer).approve(
      escrowAddress,
      AMOUNT
    );

    await escrow.connect(buyer).deposit(0);
    await escrow.connect(buyer).dispute(0);

    const buyerBalanceBefore =
      await token.balanceOf(buyer.address);

    await expect(
      escrow.connect(arbiter).resolve(0, false)
    )
      .to.emit(escrow, "OrderResolved")
      .withArgs(0, false);

    const buyerBalanceAfter =
      await token.balanceOf(buyer.address);

    expect(buyerBalanceAfter - buyerBalanceBefore)
      .to.equal(AMOUNT);

    const order = await escrow.getOrder(0);

    expect(order.status).to.equal(3n);

    expect(
      await token.balanceOf(escrowAddress)
    ).to.equal(0n);
  });
});
