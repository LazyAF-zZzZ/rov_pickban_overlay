Player position icons
=====================

Put your five position icons in THIS folder, using exactly these names:

    jungle.png
    carry.png
    midlane.png
    offlane.png
    support.png

The names are fixed. The app picks the file from the position chosen for each
player in the team registry, so a file named anything else is simply never
found and that slot shows no icon.

PNG only, and transparent background is what you want - the icon is drawn on
top of the team-coloured pick slot, so a solid background will look like a
sticker. Square images work best; around 400 x 400 px is plenty. They are
drawn at roughly half the slot width and are hidden again as soon as a hero is
picked into that slot, so fine detail is wasted.

Where the position comes from:

    Teams -> open a team -> each player row has a Position dropdown
    (Jungle / Carry / Mid lane / Off lane / Support)

Leave a player's position blank and that slot just shows no icon.

These are app artwork, like the hero images - they are committed to the
project and ship inside the installer, unlike team logos which are private to
whoever uploaded them.
