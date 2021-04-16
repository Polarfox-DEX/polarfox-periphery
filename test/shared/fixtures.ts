import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import PolarfoxFactory from '@polarfox/core/build/PolarfoxFactory.json'
import IPolarfoxPair from '@polarfox/core/build/IPolarfoxPair.json'

import ERC20 from '../../build/ERC20.json'
import WAVAX9 from '../../build/WAVAX9.json'
import PolarfoxRouter from '../../build/PolarfoxRouter.json'

const overrides = {
  gasLimit: 9999999
}

interface Fixture {
  token0: Contract
  token1: Contract
  WAVAX: Contract
  WAVAXPartner: Contract
  factory: Contract
  router: Contract
  pair: Contract
  WAVAXPair: Contract
}

export async function Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<Fixture> {
  // console.log('Entered v2Fixture')

  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WAVAX = await deployContract(wallet, WAVAX9)
  const WAVAXPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  // console.log('Deployed tokens')

  // deploy factory
  const factory = await deployContract(wallet, PolarfoxFactory, [wallet.address])
  // console.log('Deployed V2 (Polarfox) factory')

  // deploy routers
  // console.log('Wallet:', wallet)
  // console.log('IPolarfoxRouter01:', PolarfoxRouter01)
  // console.log('factory.address:', factory.address)
  // console.log('WAVAX.address:', WAVAX.address)
  // console.log('Overrides:', overrides)
  
  const router = await deployContract(wallet, PolarfoxRouter, [factory.address, WAVAX.address], overrides)
  // console.log('Deployed router 02')

  // initialize
  await factory.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IPolarfoxPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factory.createPair(WAVAX.address, WAVAXPartner.address)
  const WAVAXPairAddress = await factory.getPair(WAVAX.address, WAVAXPartner.address)
  const WAVAXPair = new Contract(WAVAXPairAddress, JSON.stringify(IPolarfoxPair.abi), provider).connect(wallet)
  // console.log('Initialized V2 factory')

  // console.log('Leaving v2Fixture')

  return {
    token0,
    token1,
    WAVAX,
    WAVAXPartner,
    factory,
    router,
    pair,
    WAVAXPair
  }
}
