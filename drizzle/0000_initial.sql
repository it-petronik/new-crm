CREATE TABLE `AuditEvent` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`actor` text NOT NULL,
	`actorId` text NOT NULL,
	`action` text NOT NULL,
	`recordId` text NOT NULL,
	`before` text,
	`after` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `AuditEvent_company_at_idx` ON `AuditEvent` (`company`,`at`);--> statement-breakpoint
CREATE TABLE `BusinessRecord` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`company` text NOT NULL,
	`branch` text NOT NULL,
	`ownerId` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `BusinessRecord_company_branch_kind_idx` ON `BusinessRecord` (`company`,`branch`,`kind`);--> statement-breakpoint
CREATE INDEX `BusinessRecord_ownerId_kind_idx` ON `BusinessRecord` (`ownerId`,`kind`);--> statement-breakpoint
CREATE TABLE `LoginAttempt` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`resetAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Session_expiresAt_idx` ON `Session` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text NOT NULL,
	`companies` text NOT NULL,
	`branches` text NOT NULL,
	`moduleAccess` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_unique` ON `User` (`email`);