CREATE TABLE `NotificationPreference` (
	`userId` text PRIMARY KEY NOT NULL,
	`desktop` integer DEFAULT false NOT NULL,
	`preview` integer DEFAULT true NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Notification` (
	`id` text PRIMARY KEY NOT NULL,
	`recipientId` text NOT NULL,
	`actorId` text,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`conversationId` text,
	`messageId` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`dedupeKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`readAt` integer,
	FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Notification_recipientId_dedupeKey_key` ON `Notification` (`recipientId`,`dedupeKey`);--> statement-breakpoint
CREATE INDEX `Notification_recipientId_id_idx` ON `Notification` (`recipientId`,`id`);--> statement-breakpoint
CREATE INDEX `Notification_recipientId_readAt_idx` ON `Notification` (`recipientId`,`readAt`);--> statement-breakpoint
CREATE INDEX `Notification_entityId_type_idx` ON `Notification` (`entityId`,`type`);--> statement-breakpoint
CREATE INDEX `Notification_createdAt_idx` ON `Notification` (`createdAt`);