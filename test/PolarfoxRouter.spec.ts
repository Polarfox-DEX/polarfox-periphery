import chai, { expect } from "chai";
import {
  solidity,
  MockProvider,
  createFixtureLoader,
  deployContract
} from "ethereum-waffle";
import { Contract } from "ethers";
import { BigNumber, bigNumberify } from "ethers/utils";
import { MaxUint256 } from "ethers/constants";
import IPolarfoxPair from "@polarfox/core/build/IPolarfoxPair.json";

import { Fixture } from "./shared/fixtures";
import {
  expandTo18Decimals,
  getApprovalDigest,
  MINIMUM_LIQUIDITY
} from "./shared/utilities";

import DeflatingERC20 from "../build/DeflatingERC20.json";
import { ecsign } from "ethereumjs-util";

chai.use(solidity);

const overrides = {
  gasLimit: 9999999
};

describe("PolarfoxRouter", () => {
  const provider = new MockProvider({
    hardfork: "istanbul",
    mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
    gasLimit: 9999999
  });
  const [wallet] = provider.getWallets();
  const loadFixture = createFixtureLoader(provider, [wallet]);

  let token0: Contract;
  let token1: Contract;
  let router: Contract;
  beforeEach(async function() {
    const fixture = await loadFixture(Fixture);
    token0 = fixture.token0;
    token1 = fixture.token1;
    router = fixture.router;
  });

  it("quote", async () => {
    expect(
      await router.quote(bigNumberify(1), bigNumberify(100), bigNumberify(200))
    ).to.eq(bigNumberify(2));
    expect(
      await router.quote(bigNumberify(2), bigNumberify(200), bigNumberify(100))
    ).to.eq(bigNumberify(1));
    await expect(
      router.quote(bigNumberify(0), bigNumberify(100), bigNumberify(200))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_AMOUNT");
    await expect(
      router.quote(bigNumberify(1), bigNumberify(0), bigNumberify(200))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.quote(bigNumberify(1), bigNumberify(100), bigNumberify(0))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountOut", async () => {
    expect(
      await router.getAmountOut(
        bigNumberify(2),
        bigNumberify(100),
        bigNumberify(100)
      )
    ).to.eq(bigNumberify(1));
    await expect(
      router.getAmountOut(bigNumberify(0), bigNumberify(100), bigNumberify(100))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_INPUT_AMOUNT");
    await expect(
      router.getAmountOut(bigNumberify(2), bigNumberify(0), bigNumberify(100))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.getAmountOut(bigNumberify(2), bigNumberify(100), bigNumberify(0))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountIn", async () => {
    expect(
      await router.getAmountIn(
        bigNumberify(1),
        bigNumberify(100),
        bigNumberify(100)
      )
    ).to.eq(bigNumberify(2));
    await expect(
      router.getAmountIn(bigNumberify(0), bigNumberify(100), bigNumberify(100))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_OUTPUT_AMOUNT");
    await expect(
      router.getAmountIn(bigNumberify(1), bigNumberify(0), bigNumberify(100))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
    await expect(
      router.getAmountIn(bigNumberify(1), bigNumberify(100), bigNumberify(0))
    ).to.be.revertedWith("PolarfoxLibrary: INSUFFICIENT_LIQUIDITY");
  });

  it("getAmountsOut", async () => {
    await token0.approve(router.address, MaxUint256);
    await token1.approve(router.address, MaxUint256);
    await router.addLiquidity(
      token0.address,
      token1.address,
      bigNumberify(10000),
      bigNumberify(10000),
      0,
      0,
      wallet.address,
      MaxUint256,
      overrides
    );

    await expect(
      router.getAmountsOut(bigNumberify(2), [token0.address])
    ).to.be.revertedWith("PolarfoxLibrary: INVALID_PATH");
    const path = [token0.address, token1.address];
    expect(await router.getAmountsOut(bigNumberify(2), path)).to.deep.eq([
      bigNumberify(2),
      bigNumberify(1)
    ]);
  });

  it("getAmountsIn", async () => {
    await token0.approve(router.address, MaxUint256);
    await token1.approve(router.address, MaxUint256);
    await router.addLiquidity(
      token0.address,
      token1.address,
      bigNumberify(10000),
      bigNumberify(10000),
      0,
      0,
      wallet.address,
      MaxUint256,
      overrides
    );

    await expect(
      router.getAmountsIn(bigNumberify(1), [token0.address])
    ).to.be.revertedWith("PolarfoxLibrary: INVALID_PATH");
    const path = [token0.address, token1.address];
    expect(await router.getAmountsIn(bigNumberify(1), path)).to.deep.eq([
      bigNumberify(2),
      bigNumberify(1)
    ]);
  });
});

describe("fee-on-transfer tokens", () => {
  const provider = new MockProvider({
    hardfork: "istanbul",
    mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
    gasLimit: 9999999
  });
  const [wallet] = provider.getWallets();
  const loadFixture = createFixtureLoader(provider, [wallet]);

  let DTT: Contract;
  let WAVAX: Contract;
  let router: Contract;
  let pair: Contract;
  beforeEach(async function() {
    const fixture = await loadFixture(Fixture);

    WAVAX = fixture.WAVAX;
    router = fixture.router;

    DTT = await deployContract(wallet, DeflatingERC20, [
      expandTo18Decimals(10000)
    ]);

    // make a DTT<>WAVAX pair
    await fixture.factory.createPair(DTT.address, WAVAX.address);
    const pairAddress = await fixture.factory.getPair(
      DTT.address,
      WAVAX.address
    );
    pair = new Contract(
      pairAddress,
      JSON.stringify(IPolarfoxPair.abi),
      provider
    ).connect(wallet);
  });

  afterEach(async function() {
    expect(await provider.getBalance(router.address)).to.eq(0);
  });

  async function addLiquidity(DTTAmount: BigNumber, WAVAXAmount: BigNumber) {
    await DTT.approve(router.address, MaxUint256);
    await router.addLiquidityAVAX(
      DTT.address,
      DTTAmount,
      DTTAmount,
      WAVAXAmount,
      wallet.address,
      MaxUint256,
      {
        ...overrides,
        value: WAVAXAmount
      }
    );
  }

  it("removeLiquidityAVAXSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(1);
    const AVAXAmount = expandTo18Decimals(4);
    await addLiquidity(DTTAmount, AVAXAmount);

    const DTTInPair = await DTT.balanceOf(pair.address);
    const WAVAXInPair = await WAVAX.balanceOf(pair.address);
    const liquidity = await pair.balanceOf(wallet.address);
    const totalSupply = await pair.totalSupply();
    const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply);
    const WAVAXExpected = WAVAXInPair.mul(liquidity).div(totalSupply);

    await pair.approve(router.address, MaxUint256);
    await router.removeLiquidityAVAXSupportingFeeOnTransferTokens(
      DTT.address,
      liquidity,
      NaiveDTTExpected,
      WAVAXExpected,
      wallet.address,
      MaxUint256,
      overrides
    );
  });

  it("removeLiquidityAVAXWithPermitSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(1)
      .mul(100)
      .div(99);
    const AVAXAmount = expandTo18Decimals(4);
    await addLiquidity(DTTAmount, AVAXAmount);

    const expectedLiquidity = expandTo18Decimals(2);

    const nonce = await pair.nonces(wallet.address);
    const digest = await getApprovalDigest(
      pair,
      {
        owner: wallet.address,
        spender: router.address,
        value: expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      },
      nonce,
      MaxUint256
    );
    const { v, r, s } = ecsign(
      Buffer.from(digest.slice(2), "hex"),
      Buffer.from(wallet.privateKey.slice(2), "hex")
    );

    const DTTInPair = await DTT.balanceOf(pair.address);
    const WAVAXInPair = await WAVAX.balanceOf(pair.address);
    const liquidity = await pair.balanceOf(wallet.address);
    const totalSupply = await pair.totalSupply();
    const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply);
    const WAVAXExpected = WAVAXInPair.mul(liquidity).div(totalSupply);

    await pair.approve(router.address, MaxUint256);
    await router.removeLiquidityAVAXWithPermitSupportingFeeOnTransferTokens(
      DTT.address,
      liquidity,
      NaiveDTTExpected,
      WAVAXExpected,
      wallet.address,
      MaxUint256,
      false,
      v,
      r,
      s,
      overrides
    );
  });

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens", () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99);
    const AVAXAmount = expandTo18Decimals(10);
    const amountIn = expandTo18Decimals(1);

    beforeEach(async () => {
      await addLiquidity(DTTAmount, AVAXAmount);
    });

    it("DTT -> WAVAX", async () => {
      await DTT.approve(router.address, MaxUint256);

      await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [DTT.address, WAVAX.address],
        wallet.address,
        MaxUint256,
        overrides
      );
    });

    // WAVAX -> DTT
    it("WAVAX -> DTT", async () => {
      await WAVAX.deposit({ value: amountIn }); // mint WAVAX
      await WAVAX.approve(router.address, MaxUint256);

      await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [WAVAX.address, DTT.address],
        wallet.address,
        MaxUint256,
        overrides
      );
    });
  });

  // AVAX -> DTT
  it("swapExactAVAXForTokensSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(10)
      .mul(100)
      .div(99);
    const AVAXAmount = expandTo18Decimals(5);
    const swapAmount = expandTo18Decimals(1);
    await addLiquidity(DTTAmount, AVAXAmount);

    await router.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
      0,
      [WAVAX.address, DTT.address],
      wallet.address,
      MaxUint256,
      {
        ...overrides,
        value: swapAmount
      }
    );
  });

  // DTT -> AVAX
  it("swapExactTokensForAVAXSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99);
    const AVAXAmount = expandTo18Decimals(10);
    const swapAmount = expandTo18Decimals(1);

    await addLiquidity(DTTAmount, AVAXAmount);
    await DTT.approve(router.address, MaxUint256);

    await router.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
      swapAmount,
      0,
      [DTT.address, WAVAX.address],
      wallet.address,
      MaxUint256,
      overrides
    );
  });
});

describe("fee-on-transfer tokens: reloaded", () => {
  const provider = new MockProvider({
    hardfork: "istanbul",
    mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
    gasLimit: 9999999
  });
  const [wallet] = provider.getWallets();
  const loadFixture = createFixtureLoader(provider, [wallet]);

  let DTT: Contract;
  let DTT2: Contract;
  let router: Contract;
  beforeEach(async function() {
    const fixture = await loadFixture(Fixture);

    router = fixture.router;

    DTT = await deployContract(wallet, DeflatingERC20, [
      expandTo18Decimals(10000)
    ]);
    DTT2 = await deployContract(wallet, DeflatingERC20, [
      expandTo18Decimals(10000)
    ]);

    // make a DTT<>WAVAX pair
    await fixture.factory.createPair(DTT.address, DTT2.address);
    const pairAddress = await fixture.factory.getPair(
      DTT.address,
      DTT2.address
    );
  });

  afterEach(async function() {
    expect(await provider.getBalance(router.address)).to.eq(0);
  });

  async function addLiquidity(DTTAmount: BigNumber, DTT2Amount: BigNumber) {
    await DTT.approve(router.address, MaxUint256);
    await DTT2.approve(router.address, MaxUint256);
    await router.addLiquidity(
      DTT.address,
      DTT2.address,
      DTTAmount,
      DTT2Amount,
      DTTAmount,
      DTT2Amount,
      wallet.address,
      MaxUint256,
      overrides
    );
  }

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens", () => {
    const DTTAmount = expandTo18Decimals(5)
      .mul(100)
      .div(99);
    const DTT2Amount = expandTo18Decimals(5);
    const amountIn = expandTo18Decimals(1);

    beforeEach(async () => {
      await addLiquidity(DTTAmount, DTT2Amount);
    });

    it("DTT -> DTT2", async () => {
      await DTT.approve(router.address, MaxUint256);

      await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        0,
        [DTT.address, DTT2.address],
        wallet.address,
        MaxUint256,
        overrides
      );
    });
  });
});
