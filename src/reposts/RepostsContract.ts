import { Field, SmartContract, state, State, method, UInt32, Gadgets } from 'o1js';
import { RepostsProof } from './Reposts.js';
import {
  PostsContract,
  newMerkleMapRoot,
  postsContractAddress,
} from '../posts/PostsContract.js';

// ============================================================================

export class RepostsContract extends SmartContract {
  @state(Field) allRepostsCounter = State<Field>();
  @state(Field) usersRepostsCounters = State<Field>();
  @state(Field) targetsRepostsCounters = State<Field>();
  @state(Field) reposts = State<Field>();

  init() {
    super.init();
    this.allRepostsCounter.set(Field(0));
    this.usersRepostsCounters.set(newMerkleMapRoot);
    this.targetsRepostsCounters.set(newMerkleMapRoot);
    this.reposts.set(newMerkleMapRoot);
  }

  @method async update(proof: RepostsProof) {
    proof.verify();
    Gadgets.rangeCheck32(proof.publicInput.blockHeight);

    this.network.blockchainLength.requireBetween(
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight),
      UInt32.Unsafe.fromField(proof.publicInput.blockHeight).add(10)
    );

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllRepostsCounter =
      this.allRepostsCounter.getAndRequireEquals();
    proof.publicInput.initialAllRepostsCounter.assertEquals(
      currentAllRepostsCounter
    );

    const currentUsersRepostsCounters =
      this.usersRepostsCounters.getAndRequireEquals();
    proof.publicInput.initialUsersRepostsCounters.assertEquals(
      currentUsersRepostsCounters
    );

    const currentTargetsRepostsCounters =
      this.targetsRepostsCounters.getAndRequireEquals();
    proof.publicInput.initialTargetsRepostsCounters.assertEquals(
      currentTargetsRepostsCounters
    );

    const currentReposts = this.reposts.getAndRequireEquals();
    proof.publicInput.initialReposts.assertEquals(currentReposts);

    this.allRepostsCounter.set(proof.publicInput.latestAllRepostsCounter);
    this.usersRepostsCounters.set(
      proof.publicInput.latestUsersRepostsCounters
    );
    this.targetsRepostsCounters.set(
      proof.publicInput.latestTargetsRepostsCounters
    );
    this.reposts.set(proof.publicInput.latestReposts);
  }
}
