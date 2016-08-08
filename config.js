/* jshint -W117 */
export const GITHUB_USERNAME = process.env.GITHUB_USERNAME;     // Your bot's Github username
export const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD;     // Your bot's Github password

export const REPOSITORY_OWNER = process.env.REPOSITORY_OWNER;   // The owner of the repository you want to run the bot on.
export const REPOSITORY_NAME = process.env.REPOSITORY_NAME;     // The name of the repository you want to run the bot on.

export const FILE_FILTER = process.env.FILE_FILTER || /.*(.js|.jsx)$/; // By default, lint every single .js or .jsx file
