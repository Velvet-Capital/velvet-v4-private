factory(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Factory
factories(
skip: Int = 0
first: Int = 100
orderBy: Factory_orderBy
orderDirection: OrderDirection
where: Factory_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Factory!]!
bundle(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Bundle
bundles(
skip: Int = 0
first: Int = 100
orderBy: Bundle_orderBy
orderDirection: OrderDirection
where: Bundle_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Bundle!]!
token(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Token
tokens(
skip: Int = 0
first: Int = 100
orderBy: Token_orderBy
orderDirection: OrderDirection
where: Token_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Token!]!
pool(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Pool
pools(
skip: Int = 0
first: Int = 100
orderBy: Pool_orderBy
orderDirection: OrderDirection
where: Pool_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Pool!]!
tick(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Tick
ticks(
skip: Int = 0
first: Int = 100
orderBy: Tick_orderBy
orderDirection: OrderDirection
where: Tick_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Tick!]!
transaction(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Transaction
transactions(
skip: Int = 0
first: Int = 100
orderBy: Transaction_orderBy
orderDirection: OrderDirection
where: Transaction_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Transaction!]!
mint(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Mint
mints(
skip: Int = 0
first: Int = 100
orderBy: Mint_orderBy
orderDirection: OrderDirection
where: Mint_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Mint!]!
burn(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Burn
burns(
skip: Int = 0
first: Int = 100
orderBy: Burn_orderBy
orderDirection: OrderDirection
where: Burn_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Burn!]!
swap(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Swap
swaps(
skip: Int = 0
first: Int = 100
orderBy: Swap_orderBy
orderDirection: OrderDirection
where: Swap_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Swap!]!
collect(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Collect
collects(
skip: Int = 0
first: Int = 100
orderBy: Collect_orderBy
orderDirection: OrderDirection
where: Collect_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Collect!]!
fusionDayData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): FusionDayData
fusionDayDatas(
skip: Int = 0
first: Int = 100
orderBy: FusionDayData_orderBy
orderDirection: OrderDirection
where: FusionDayData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [FusionDayData!]!
poolDayData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): PoolDayData
poolDayDatas(
skip: Int = 0
first: Int = 100
orderBy: PoolDayData_orderBy
orderDirection: OrderDirection
where: PoolDayData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [PoolDayData!]!
poolFeeData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): PoolFeeData
poolFeeDatas(
skip: Int = 0
first: Int = 100
orderBy: PoolFeeData_orderBy
orderDirection: OrderDirection
where: PoolFeeData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [PoolFeeData!]!
poolHourData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): PoolHourData
poolHourDatas(
skip: Int = 0
first: Int = 100
orderBy: PoolHourData_orderBy
orderDirection: OrderDirection
where: PoolHourData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [PoolHourData!]!
tokenDayData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): TokenDayData
tokenDayDatas(
skip: Int = 0
first: Int = 100
orderBy: TokenDayData_orderBy
orderDirection: OrderDirection
where: TokenDayData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [TokenDayData!]!
tokenHourData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): TokenHourData
tokenHourDatas(
skip: Int = 0
first: Int = 100
orderBy: TokenHourData_orderBy
orderDirection: OrderDirection
where: TokenHourData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [TokenHourData!]!
feeHourData(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): FeeHourData
feeHourDatas(
skip: Int = 0
first: Int = 100
orderBy: FeeHourData_orderBy
orderDirection: OrderDirection
where: FeeHourData_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [FeeHourData!]!
position(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Position
positions(
skip: Int = 0
first: Int = 100
orderBy: Position_orderBy
orderDirection: OrderDirection
where: Position_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Position!]!
positionSnapshot(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): PositionSnapshot
positionSnapshots(
skip: Int = 0
first: Int = 100
orderBy: PositionSnapshot_orderBy
orderDirection: OrderDirection
where: PositionSnapshot_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [PositionSnapshot!]!
plugin(
id: ID!
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): Plugin
plugins(
skip: Int = 0
first: Int = 100
orderBy: Plugin_orderBy
orderDirection: OrderDirection
where: Plugin_filter
block: Block_height
subgraphError: _SubgraphErrorPolicy_! = deny
): [Plugin!]!
_meta(block: Block_height): _Meta_