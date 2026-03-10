/**
 * LinkedIn Actions — barrel exports
 *
 * Actions that mutate state on LinkedIn: send message, create post,
 * comment, react, and manage connections.
 */

export { sendMessage } from './send-message';
export { createPost } from './create-post';
export { postComment } from './comment';
export { reactToPost } from './react';
export { sendConnectionRequest, acceptConnectionRequest } from './connect';
