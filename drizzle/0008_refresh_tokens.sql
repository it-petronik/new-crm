CREATE TABLE `RefreshToken` (
	`id` text PRIMARY KEY NOT NULL,
	`familyId` text NOT NULL,
	`userId` text NOT NULL,
	`sessionId` text,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`familyCreatedAt` integer NOT NULL,
	`usedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `RefreshToken_familyId_idx` ON `RefreshToken` (`familyId`);--> statement-breakpoint
CREATE INDEX `RefreshToken_userId_idx` ON `RefreshToken` (`userId`);--> statement-breakpoint
CREATE INDEX `RefreshToken_sessionId_idx` ON `RefreshToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `RefreshToken_expiresAt_idx` ON `RefreshToken` (`expiresAt`);