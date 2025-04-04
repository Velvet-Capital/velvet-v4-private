// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import {MetaAggregatorManager} from "../MetaAggregatorManager.sol";

contract MetaAggregatorTestManager is MetaAggregatorManager {
    constructor(address _metaAggregatorTestSwap) MetaAggregatorManager(_metaAggregatorTestSwap){}
}