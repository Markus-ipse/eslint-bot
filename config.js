const { env } = process;
export const GITHUB_USERNAME = env.GITHUB_USERNAME;     // Your bot's Github username
export const GITHUB_PASSWORD = env.GITHUB_PASSWORD;     // Your bot's Github password

export const REPOSITORY_OWNER = env.REPOSITORY_OWNER;   // The owner of the repository you want to run the bot on.
export const REPOSITORY_NAME = env.REPOSITORY_NAME;     // The name of the repository you want to run the bot on.

export const FILE_FILTER = env.FILE_FILTER || /.*(.js|.jsx)$/; // By default, lint every single .js or .jsx file
