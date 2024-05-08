import { Field, SmartContract, state, State, method, UInt32, Gadgets } from 'o1js';
import { ReactionsProof } from './Reactions.js';
import {
  PostsContract,
  newMerkleMapRoot,
  postsContractAddress,
} from '../posts/PostsContract.js';

// ============================================================================

export class ReactionsContract extends SmartContract {
  @state(Field) allReactionsCounter = State<Field>();
  @state(Field) usersReactionsCounters = State<Field>();
  @state(Field) targetsReactionsCounters = State<Field>();
  @state(Field) reactions = State<Field>();

  init() {
    super.init();
    this.allReactionsCounter.set(Field(0));
    this.usersReactionsCounters.set(newMerkleMapRoot);
    this.targetsReactionsCounters.set(newMerkleMapRoot);
    this.reactions.set(newMerkleMapRoot);
  }

  @method async update(proof: ReactionsProof) {
    proof.verify();
    Gadgets.rangeCheck32(proof.publicInput.blockHeight);

    this.network.blockchainLength.requireBetween(
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight),
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight).add(1)
    );

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllReactionsCounter =
      this.allReactionsCounter.getAndRequireEquals();
    proof.publicInput.initialAllReactionsCounter.assertEquals(
      currentAllReactionsCounter
    );

    const currentUsersReactionsCounters =
      this.usersReactionsCounters.getAndRequireEquals();
    proof.publicInput.initialUsersReactionsCounters.assertEquals(
      currentUsersReactionsCounters
    );

    const currentTargetsReactionsCounters =
      this.targetsReactionsCounters.getAndRequireEquals();
    proof.publicInput.initialTargetsReactionsCounters.assertEquals(
      currentTargetsReactionsCounters
    );

    const currentReactions = this.reactions.getAndRequireEquals();
    proof.publicInput.initialReactions.assertEquals(currentReactions);

    this.allReactionsCounter.set(proof.publicInput.latestAllReactionsCounter);
    this.usersReactionsCounters.set(
      proof.publicInput.latestUsersReactionsCounters
    );
    this.targetsReactionsCounters.set(
      proof.publicInput.latestTargetsReactionsCounters
    );
    this.reactions.set(proof.publicInput.latestReactions);
  }
}
