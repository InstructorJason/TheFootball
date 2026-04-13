# The Football

The goal of this application is to provide a means to gather, distribute, and project media files (photos and short videos) in an off-network situation.
It was not intended to  run long-term, and is for non-critical use cases.

Please note that while it is intended to be used in an isolated fashion, the initial docker build will most likely need to be done with internet
available.

## A Few Details...

* There are a handful of configuration details (initial admin account, port number, etc.) that can be set in `docker-compose.yml`.
* Uploading and downloading media does not require any authorization, and that was by design.  But, an admin must approve files before they appear in the gallery and are available for display/download.
* The displayed name for the application can be changed from "The Gallery" in the admin menu. 

## To run

1. Download the project in its entirety, unzipping as appropriate.
2. Open a terminal in the `the-football` directory.
3. Build/run the container.  For example: `docker compose up -d --build`.  If in doubt, google is your friend.
4. Access the application using a browser.  For example: `localhost:3000`.  Note that the default port of the application is different than the default port used by most browsers.

## History
This project got its name as a reference to the nuclear football.  The original implementation ran on a mac mini in a metal briefcase and was used to handle media
at an event for scouts.  Could it have been a simple laptop?  Sure, but where's the fun in that??
![IMG_3595](https://github.com/user-attachments/assets/4340a21f-44d1-42d7-8bbf-e0d854dc3178)
