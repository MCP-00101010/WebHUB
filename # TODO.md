# TODO for Morpheus WebHUB

## File structure

- move source files into a project subdirectory called "source" to keep project folder more tidy.
- create git repo for this project.

## Data Types

- add a favicon-cache property to the bookmarks type to store their favicons and use the cache if present rather than reloading the favicon every time we open the hub in a browser.

## Optimization

- are we using different dialogues for "Add Bookmark"/"Edit Bookmark" depending from where they get invoked (speed dial pane, bookmarks pane/essentials, all eligible context menus). If so can we use only one dialogue for adding/editing bookmarks for all cases?
- same question for dividers, titles and folders.

## UI


## Customization

- add the following customizations to the Global Settings dialogue:n ger
  - a container for bookmark display options with the following options:
    - font size for Bookmark names (give it a sensible default value)
    - wether or not show bookmark tags in the bookmarks pane (radio buttons)
  - a container for folder display options with the following options:
    - font size for Folder names (default = bookmark text size+1)
  - a container for Title and Divider Options:
    - font size for Title Names
    - line thickness in pixels, default 3, adjusted via a "plus" icon on the left and a "minus" icon on the right
  - a container for Board Title Display Options with the following options:
    - font size for Board Name (give it a sensible default value)
  
    - a really cool feature would be a tag editor where you can select a different color for the bubble the tags are shown in (for each tag). not super important tho.
    - another cool feature: let the user select a different font for Bookmarks/Titles/Folder Names/Board Names.
    - another cool feature: add other font options to bookmark names/titles/folder names/board titles (bold, italic, underline)
  - add an option to add a background image to the board. either via url or have and field where we can drag and drop an image from our hard drive into. the board object needs a background-image property to store the image.
  - how do we scale he image to the size of the board pane?
  - with background images, we probably need settings for transparency for the containers (board title, speed dial pane, columns) in the bookmarks pane. add these settings to the board settings. use a slider setting from 0% - 100%. One slider to control all panes. update css while using the slider so we can se the effect.
- update the render logic to use these settings instead of currently default values.

## current Issues:

## Drag and Drop functionality

- is it possible to allow a bookmark from the browser to be dropped on the speed dial pane/bookmarks pane/essentials buttons that then opens the edit bookmark dialogue and then places the bookmark where the user dropped it? (QoL feature - would be very neat). Can this be implemented browser agnostic or would different browser types need a different logic? please advise on this.

## Storage

- instead of storing all data in localStorage, create a database in a file. load the database when we open the project in a browser and automatically save the database after we deleted/added/edited or dragged an object around.
(What would be the ideal format for this? JSON?)
