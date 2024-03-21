import {
  PostState,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
} from './posts/Posts.js';
import {
  ReactionState,
  fieldToFlagReactionsAsDeleted,
  fieldToFlagReactionsAsRestored,
} from './reactions/Reactions.js';
import {
  CommentState,
  fieldToFlagCommentsAsDeleted,
  fieldToFlagCommentsAsRestored,
} from './comments/Comments.js';
import {
  RepostState,
  fieldToFlagTargetAsReposted,
  fieldToFlagRepostsAsDeleted,
  fieldToFlagRepostsAsRestored,
} from './reposts/Reposts.js';

export {
  PostState,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
  ReactionState,
  fieldToFlagReactionsAsDeleted,
  fieldToFlagReactionsAsRestored,
  CommentState,
  fieldToFlagCommentsAsDeleted,
  fieldToFlagCommentsAsRestored,
  RepostState,
  fieldToFlagTargetAsReposted,
  fieldToFlagRepostsAsDeleted,
  fieldToFlagRepostsAsRestored,
};
