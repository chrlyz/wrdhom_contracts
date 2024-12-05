import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  Gadgets,
  Poseidon,
  MerkleMapWitness
} from 'o1js';
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
  @state(Field) lastUpdate = State<Field>();
  @state(Field) stateHistory = State<Field>();

  init() {
    super.init();
    this.allRepostsCounter.set(Field(0));
    this.usersRepostsCounters.set(newMerkleMapRoot);
    this.targetsRepostsCounters.set(newMerkleMapRoot);
    this.reposts.set(newMerkleMapRoot);
    this.lastUpdate.set(Field(0));
    this.stateHistory.set(newMerkleMapRoot);
  }

  @method async update(proof: RepostsProof, stateHistoryWitness: MerkleMapWitness) {
    proof.verify();

    Gadgets.rangeCheck32(proof.publicInput.blockHeight);
    const blockHeightAsField = proof.publicInput.blockHeight;
    const blockHeight = UInt32.Unsafe.fromField(proof.publicInput.blockHeight);
    this.network.blockchainLength.requireBetween(blockHeight,blockHeight.add(10));

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllRepostsCounter = this.allRepostsCounter.getAndRequireEquals();
    const initialAllRepostsCounter = proof.publicInput.initialAllRepostsCounter;
    currentAllRepostsCounter.assertEquals(initialAllRepostsCounter);

    const currentUsersRepostsCounters = this.usersRepostsCounters.getAndRequireEquals();
    const initialUsersRepostsCounters = proof.publicInput.initialUsersRepostsCounters;
    currentUsersRepostsCounters.assertEquals(initialUsersRepostsCounters);

    const currentTargetsRepostsCounters = this.targetsRepostsCounters.getAndRequireEquals();
    const initialTargetsRepostsCounters = proof.publicInput.initialTargetsRepostsCounters;
    currentTargetsRepostsCounters.assertEquals(initialTargetsRepostsCounters);

    const currentReposts = this.reposts.getAndRequireEquals();
    const initialReposts = proof.publicInput.initialReposts;
    currentReposts.assertEquals(initialReposts);

    const currentStateHistory = this.stateHistory.getAndRequireEquals();
    const [initialStateHistory, stateHistoryKey] = stateHistoryWitness.computeRootAndKeyV2(Field(0));
    currentStateHistory.assertEquals(initialStateHistory);
    blockHeightAsField.assertEquals(stateHistoryKey);

    const latestAllRepostsCounter = proof.publicInput.latestAllRepostsCounter;
    const latestUsersRepostsCounters = proof.publicInput.latestUsersRepostsCounters;
    const latestTargetsRepostsCounters = proof.publicInput.latestTargetsRepostsCounters;
    const latestReposts = proof.publicInput.latestReposts;

    const latestState = Poseidon.hash([
      latestAllRepostsCounter,
      latestUsersRepostsCounters,
      latestTargetsRepostsCounters,
      latestReposts
    ]);
    const latestStateHistory = stateHistoryWitness.computeRootAndKeyV2(latestState)[0];

    this.allRepostsCounter.set(latestAllRepostsCounter);
    this.usersRepostsCounters.set(latestUsersRepostsCounters);
    this.targetsRepostsCounters.set(latestTargetsRepostsCounters);
    this.reposts.set(latestReposts);
    this.lastUpdate.set(blockHeightAsField);
    this.stateHistory.set(latestStateHistory);
  }
}
