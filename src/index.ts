import {
  PostState,
  PostsTransition,
  Posts,
  PostsProof,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored
} from './posts/Posts.js';
import { PostsContract } from './posts/PostsContract.js';
import {
  ReactionState,
  ReactionsTransition,
  Reactions,
  ReactionsProof,
} from './reactions/Reactions.js';
import { ReactionsContract } from './reactions/ReactionsContract.js';
import {
  CommentState,
  CommentsTransition,
  Comments,
  CommentsProof,
} from './comments/Comments.js';
import { CommentsContract } from './comments/CommentsContract.js';
import   {
  RepostState,
  RepostsTransition,
  Reposts,
  RepostsProof,
  fieldToFlagTargetAsReposted
} from './reposts/Reposts.js';
import { RepostsContract } from './reposts/RepostsContract.js';
import { Config } from './posts/PostsDeploy.js';

export {
  PostState,
  PostsTransition,
  Posts,
  PostsProof,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
  PostsContract,
  ReactionState,
  ReactionsTransition,
  Reactions,
  ReactionsProof,
  ReactionsContract,
  CommentState,
  CommentsTransition,
  Comments,
  CommentsProof,
  CommentsContract,
  RepostState,
  RepostsTransition,
  Reposts,
  RepostsProof,
  fieldToFlagTargetAsReposted,
  RepostsContract,
  Config,
};
