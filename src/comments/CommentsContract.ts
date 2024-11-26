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
  @state(Field) lastUpdate = State<Field>();
  @state(Field) stateHistory = State<Field>();

  init() {
    super.init();
    this.allCommentsCounter.set(Field(0));
    this.usersCommentsCounters.set(newMerkleMapRoot);
    this.targetsCommentsCounters.set(newMerkleMapRoot);
    this.comments.set(newMerkleMapRoot);
    this.lastUpdate.set(Field(0));
    this.stateHistory.set(newMerkleMapRoot);
  }

  @method async update(proof: CommentsProof, stateHistoryWitness: MerkleMapWitness) {
    proof.verify();

    Gadgets.rangeCheck32(proof.publicInput.blockHeight);
    const blockHeightAsField = proof.publicInput.blockHeight;
    const blockHeight = UInt32.Unsafe.fromField(proof.publicInput.blockHeight);
    this.network.blockchainLength.requireBetween(blockHeight,blockHeight.add(10));

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllCommentsCounter = this.allCommentsCounter.getAndRequireEquals();
    const initialAllCommentsCounter = proof.publicInput.initialAllCommentsCounter;
    currentAllCommentsCounter.assertEquals(initialAllCommentsCounter);

    const currentUsersCommentsCounters = this.usersCommentsCounters.getAndRequireEquals();
    const initialUsersCommentsCounters = proof.publicInput.initialUsersCommentsCounters;
    currentUsersCommentsCounters.assertEquals(initialUsersCommentsCounters);

    const currentTargetsCommentsCounters = this.targetsCommentsCounters.getAndRequireEquals();
    const initialTargetsCommentsCounters = proof.publicInput.initialTargetsCommentsCounters;
    currentTargetsCommentsCounters.assertEquals(initialTargetsCommentsCounters);

    const currentComments = this.comments.getAndRequireEquals();
    const initialComments = proof.publicInput.initialComments;
    currentComments.assertEquals(initialComments);

    const currentStateHistory = this.stateHistory.getAndRequireEquals();
    const [initialStateHistory, stateHistoryKey] = stateHistoryWitness.computeRootAndKeyV2(Field(0));
    currentStateHistory.assertEquals(initialStateHistory);
    blockHeightAsField.assertEquals(stateHistoryKey);

    const latestAllCommentsCounter = proof.publicInput.latestAllCommentsCounter;
    const latestUsersCommentsCounters = proof.publicInput.latestUsersCommentsCounters;
    const latestTargetsCommentsCounters = proof.publicInput.latestTargetsCommentsCounters;
    const latestComments = proof.publicInput.latestComments;

    const latestState = Poseidon.hash([
      latestAllCommentsCounter,
      latestUsersCommentsCounters,
      latestTargetsCommentsCounters,
      latestComments
    ]);
    const latestStateHistory = stateHistoryWitness.computeRootAndKeyV2(latestState)[0];

    this.allCommentsCounter.set(latestAllCommentsCounter);
    this.usersCommentsCounters.set(latestUsersCommentsCounters);
    this.targetsCommentsCounters.set(latestTargetsCommentsCounters);
    this.comments.set(latestComments);
    this.lastUpdate.set(blockHeightAsField);
    this.stateHistory.set(latestStateHistory);
  }
}