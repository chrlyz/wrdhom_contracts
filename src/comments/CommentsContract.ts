import { Field, SmartContract, state, State, method, UInt32, Gadgets } from 'o1js';
import { CommentsProof } from './Comments.js';
import {
  PostsContract,
  newMerkleMapRoot,
  postsContractAddress,
} from '../posts/PostsContract.js';

// ============================================================================

export class CommentsContract extends SmartContract {
  @state(Field) allCommentsCounter = State<Field>();
  @state(Field) usersCommentsCounters = State<Field>();
  @state(Field) targetsCommentsCounters = State<Field>();
  @state(Field) comments = State<Field>();

  init() {
    super.init();
    this.allCommentsCounter.set(Field(0));
    this.usersCommentsCounters.set(newMerkleMapRoot);
    this.targetsCommentsCounters.set(newMerkleMapRoot);
    this.comments.set(newMerkleMapRoot);
  }

  @method async update(proof: CommentsProof) {
    proof.verify();
    Gadgets.rangeCheck32(proof.publicInput.blockHeight);

    this.network.blockchainLength.requireBetween(
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight),
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight).add(10)
    );

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllCommentsCounter =
      this.allCommentsCounter.getAndRequireEquals();
    proof.publicInput.initialAllCommentsCounter.assertEquals(
      currentAllCommentsCounter
    );

    const currentUsersCommentsCounters =
      this.usersCommentsCounters.getAndRequireEquals();
    proof.publicInput.initialUsersCommentsCounters.assertEquals(
      currentUsersCommentsCounters
    );

    const currentTargetsCommentsCounters =
      this.targetsCommentsCounters.getAndRequireEquals();
    proof.publicInput.initialTargetsCommentsCounters.assertEquals(
      currentTargetsCommentsCounters
    );

    const currentComments = this.comments.getAndRequireEquals();
    proof.publicInput.initialComments.assertEquals(currentComments);

    this.allCommentsCounter.set(proof.publicInput.latestAllCommentsCounter);
    this.usersCommentsCounters.set(
      proof.publicInput.latestUsersCommentsCounters
    );
    this.targetsCommentsCounters.set(
      proof.publicInput.latestTargetsCommentsCounters
    );
    this.comments.set(proof.publicInput.latestComments);
  }
}
