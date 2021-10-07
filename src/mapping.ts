import { BigInt, store, log, ethereum } from "@graphprotocol/graph-ts"
import {
  Trading,
  AddMargin,
  ClosePosition,
  NewPosition,
  OpenOrder
} from "../generated/Trading/Trading"
import { Vault, Product, Position, Trade, VaultDayData } from "../generated/schema"

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)
export const UNIT_BI = BigInt.fromI32(100000000)

export const BASE_FEE = BigInt.fromI32(25) // 0.25%
export const LIQUIDATION_THRESHOLD = BigInt.fromI32(8000)
export const BPS_SCALER = BigInt.fromI32(10000)

function getVaultDayData(event: ethereum.Event): VaultDayData {

  let timestamp = event.block.timestamp.toI32()
  let day_id = timestamp / 86400
  let vaultDayData = VaultDayData.load(day_id.toString())

  if (vaultDayData == null) {
    vaultDayData = new VaultDayData(day_id.toString())
    vaultDayData.date = BigInt.fromI32(day_id * 86400)
    vaultDayData.cumulativeVolume = ZERO_BI
    vaultDayData.cumulativeMargin = ZERO_BI
    vaultDayData.positionCount = ZERO_BI
    vaultDayData.tradeCount = ZERO_BI
    vaultDayData.save()
  }

  return vaultDayData!

}

export function handleNewPosition(event: NewPosition): void {

  // Create position
  let position = new Position(event.params.positionId.toString())

  position.productId = event.params.productId
  position.leverage = event.params.leverage
  position.price = event.params.price
  position.margin = event.params.margin

  let amount = event.params.margin.times(event.params.leverage).div(UNIT_BI)
  position.amount = amount

  position.owner = event.params.user

  position.isLong = event.params.isLong

  position.createdAtTimestamp = event.block.timestamp
  position.createdAtBlockNumber = event.block.number

  let product = Product.load((event.params.productId).toString())

  if (product == null) {

    product = new Product(event.params.productId.toString())

    product.cumulativePnl = ZERO_BI
    product.cumulativeVolume = ZERO_BI
    product.cumulativeMargin = ZERO_BI

    product.positionCount = ZERO_BI
    product.tradeCount = ZERO_BI

  }

  let liquidationPrice = ZERO_BI
  if (position.isLong) {
    liquidationPrice = position.price.minus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
  } else {
    liquidationPrice = position.price.plus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
  }

  position.liquidationPrice = liquidationPrice

  // volume updates
  let vault = Vault.load((1).toString())
  vault.cumulativeFees = vault.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
  vault.cumulativeVolume = vault.cumulativeVolume.plus(amount)
  vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)
  vault.positionCount = vault.positionCount.plus(ONE_BI)

  let vaultDayData = getVaultDayData(event)
  vaultDayData.cumulativeFees = vaultDayData.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
  vaultDayData.cumulativeVolume = vaultDayData.cumulativeVolume.plus(amount)
  vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)
  vaultDayData.positionCount = vaultDayData.positionCount.plus(ONE_BI)

  product.cumulativeFees = product.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
  product.cumulativeVolume = product.cumulativeVolume.plus(amount)
  product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
  product.positionCount = product.positionCount.plus(ONE_BI)

  position.save()
  vault.save()
  vaultDayData.save()
  product.save()

}

export function handleAddMargin(event: AddMargin): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    position.margin = event.params.newMargin
    position.leverage = event.params.newLeverage

    position.updatedAtTimestamp = event.block.timestamp
    position.updatedAtBlockNumber = event.block.number

    // volume updates

    let vault = Vault.load((1).toString())
    vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)

    let vaultDayData = getVaultDayData(event)
    vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)

    let product = Product.load((position.productId).toString())
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)

    let liquidationPrice = ZERO_BI
    if (position.isLong) {
      liquidationPrice = position.price.minus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
    } else {
      liquidationPrice = position.price.plus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
    }

    position.liquidationPrice = liquidationPrice

    position.save()
    vault.save()
    vaultDayData.save()
    product.save()

  }

}

export function handleClosePosition(event: ClosePosition): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    let vault = Vault.load((1).toString())
    let vaultDayData = getVaultDayData(event)
    let product = Product.load((event.params.productId).toString())

    vault.tradeCount = vault.tradeCount.plus(ONE_BI)

    let amount = event.params.margin.times(event.params.leverage).div(UNIT_BI)

    // create new trade
    let trade = new Trade(vault.tradeCount.toString())
    trade.txHash = event.transaction.hash.toHexString()
    
    trade.positionId = event.params.positionId
    trade.productId = event.params.productId
    trade.leverage = event.params.leverage

    trade.amount = amount
    
    trade.entryPrice = event.params.entryPrice
    trade.closePrice = event.params.price

    trade.margin = event.params.margin
    trade.owner = event.params.user

    trade.fee = amount.times(BASE_FEE).div(BPS_SCALER)
    trade.pnl = event.params.pnl
    trade.pnlIsNegative = event.params.pnlIsNegative
    trade.wasLiquidated = event.params.wasLiquidated
    trade.isFullClose = event.params.isFullClose

    trade.isLong = position.isLong

    trade.duration = event.block.timestamp.minus(position.createdAtTimestamp)

    trade.timestamp = event.block.timestamp
    trade.blockNumber = event.block.number

    // Update position

    if (event.params.isFullClose) {
      store.remove('Position', event.params.positionId.toString())
      vault.positionCount = vault.positionCount.minus(ONE_BI)
      product.positionCount = product.positionCount.minus(ONE_BI)
    } else {
      // Update position with partial close, e.g. subtract margin
      position.margin = position.margin.minus(event.params.margin)
      position.amount = position.amount.minus(amount)
      position.save()
    }

    // update volumes

    vault.cumulativeFees = vault.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
    vault.cumulativeVolume = vault.cumulativeVolume.plus(amount)
    vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)

    if (trade.pnlIsNegative) {
      vault.cumulativePnl = vault.cumulativePnl.minus(event.params.pnl)
      vault.balance = vault.balance.plus(event.params.pnl)
      vaultDayData.cumulativePnl = vaultDayData.cumulativePnl.minus(event.params.pnl)
      product.cumulativePnl = product.cumulativePnl.minus(event.params.pnl)
    } else {
      vault.cumulativePnl = vault.cumulativePnl.plus(event.params.pnl)
      vault.balance = vault.balance.minus(event.params.pnl)
      vaultDayData.cumulativePnl = vaultDayData.cumulativePnl.plus(event.params.pnl)
      product.cumulativePnl = product.cumulativePnl.plus(event.params.pnl)
    }

    vaultDayData.cumulativeFees = vaultDayData.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
    vaultDayData.cumulativeVolume = vaultDayData.cumulativeVolume.plus(amount)
    vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)
    vaultDayData.tradeCount = vaultDayData.tradeCount.plus(ONE_BI)

    product.cumulativeFees = product.cumulativeFees.plus(amount.times(BASE_FEE).div(BPS_SCALER))
    product.cumulativeVolume = product.cumulativeVolume.plus(amount)
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
    product.tradeCount = product.tradeCount.plus(ONE_BI)

    trade.save()
    vault.save()
    vaultDayData.save()
    product.save()

  }

}

export function handleOpenOrder(event: OpenOrder): void {}