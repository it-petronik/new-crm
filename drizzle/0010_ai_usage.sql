CREATE TABLE `AiUsage` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`feature` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`durationMs` integer NOT NULL,
	`promptChars` integer NOT NULL,
	`outputChars` integer NOT NULL,
	`promptTokens` integer,
	`completionTokens` integer,
	`flaggedBlocks` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `AiUsage_userId_createdAt_idx` ON `AiUsage` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `AiUsage_createdAt_idx` ON `AiUsage` (`createdAt`);