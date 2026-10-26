-- Safety net: the DB itself rejects negative balances (requires MySQL 8.0.16+).
ALTER TABLE `Wallet` ADD CONSTRAINT `wallet_balance_non_negative` CHECK (`balance` >= 0);