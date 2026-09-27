CREATE TABLE `ProactiveState` (
	`userId` text NOT NULL,
	`signalKey` text NOT NULL,
	`fingerprint` text NOT NULL,
	`snoozedUntil` integer,
	`dismissedAt` integer,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `signalKey`),
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
