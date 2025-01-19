#!/bin/bash

echo "--Stopping all pm2 processes..."
pm2 delete all

apps="DJ-Pasha_InternetCafe DJ-Pasha_BizsRemoteTTRPG"

#Back up
for app in $apps
do
	echo "--Backing up $app..."
	cp $app/app.db /mnt/external-drive/DJ-Pasha-Admin/backup/app.db.$app
	echo "--Backing up $app done."
	echo "--Resetting git repo for $app..."
	git -C $app reset --hard
	echo "--Resetting git repo for $app done."
	echo "--Pulling $app..."
	git -C $app pull --ff
	echo "--Pulling $app done."
    echo "--Install npm packages $app..."
	npm --prefix $app ci
    echo "--Install npm packages $app done."
	echo "--Building project $app..."
	npm --prefix $app run-script build
	echo "--Building project $app done."
done
echo "--Done."

pm2 start;
