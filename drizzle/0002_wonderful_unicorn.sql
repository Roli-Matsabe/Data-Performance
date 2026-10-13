CREATE TABLE `google_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`refresh_token` text,
	`config` text,
	`connected_at` text,
	`last_sync` text,
	`last_error` text,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_sync_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_reports` (
	`owner` text NOT NULL,
	`property_id` text NOT NULL,
	`month` text NOT NULL,
	`config_key` text NOT NULL,
	`payload` text NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`owner`, `property_id`, `month`)
);
--> statement-breakpoint
CREATE TABLE `google_oauth_states` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`verifier` text NOT NULL,
	`expires` integer NOT NULL
);
