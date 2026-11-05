// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AuditAnchor
/// @notice Records Merkle roots of REDSTRING snapshot hashes. Events only, no storage.
contract AuditAnchor {
    address public immutable writer;

    event Anchored(bytes32 indexed root, uint256 count, uint256 timestamp);

    constructor(address _writer) {
        writer = _writer;
    }

    function anchor(bytes32 root, uint256 count) external {
        require(msg.sender == writer, "not writer");
        emit Anchored(root, count, block.timestamp);
    }
}
