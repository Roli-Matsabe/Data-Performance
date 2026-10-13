CREATE TABLE `property_reports` (
	`owner` text NOT NULL,
	`property_id` text NOT NULL,
	`month` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `property_id`, `month`)
);
