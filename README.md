# Days (days-next)

A successor to Days (now https://days-og.ohn.sh), a blog experiment focused on aggregating various sources into a day-oriented feed. This version sticks with Astro but is server-rendered. Currently, routes for recent days are cached for 1 minute, while routes for historical days cached for a week.

days-next also adds [VOD](https://vod.ohn.sh) as a data source, along with a plain Git adapter that reads refs and commits directly from local clones instead of using the GitHub API. Currently, day routes render both plain Git and GitHub content--I'm not yet sure if I'm going to completely remove GitHub.

Live at https://days.ohn.sh
