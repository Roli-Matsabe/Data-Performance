CREATE TABLE `reports` (
	`owner` text NOT NULL,
	`month` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `month`)
);
