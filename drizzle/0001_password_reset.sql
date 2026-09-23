CREATE TABLE `PasswordReset` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`issuedBy` text NOT NULL,
	`issuedByName` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `PasswordReset_userId_idx` ON `PasswordReset` (`userId`);--> statement-breakpoint
CREATE INDEX `PasswordReset_expiresAt_idx` ON `PasswordReset` (`expiresAt`);