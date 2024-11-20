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
  @state(Field) lastUpdate = State<Field>();
  @state(Field) stateHistory = State<Field>();

  init() {
    super.init();
    this.allReactionsCounter.set(Field(0));
    this.usersReactionsCounters.set(newMerkleMapRoot);
    this.targetsReactionsCounters.set(newMerkleMapRoot);
    this.reactions.set(newMerkleMapRoot);
    this.lastUpdate.set(Field(0));
    this.stateHistory.set(newMerkleMapRoot);
  }

  @method async update(proof: ReactionsProof, stateHistoryWitness: MerkleMapWitness) {
    proof.verify();

    Gadgets.rangeCheck32(proof.publicInput.blockHeight);
    const blockHeightAsField = proof.publicInput.blockHeight;
    const blockHeight = UInt32.Unsafe.fromField(proof.publicInput.blockHeight);
    this.network.blockchainLength.requireBetween(blockHeight,blockHeight.add(10));

    const postsContract = new PostsContract(postsContractAddress);
    const currentPosts = postsContract.posts.getAndRequireEquals();
    proof.publicInput.targets.assertEquals(currentPosts);

    const currentAllReactionsCounter = this.allReactionsCounter.getAndRequireEquals();
    const initialAllReactionsCounter = proof.publicInput.initialAllReactionsCounter;
    currentAllReactionsCounter.assertEquals(initialAllReactionsCounter);

    const currentUsersReactionsCounters = this.usersReactionsCounters.getAndRequireEquals();
    const initialUsersReactionsCounters = proof.publicInput.initialUsersReactionsCounters;
    currentUsersReactionsCounters.assertEquals(initialUsersReactionsCounters);

    const currentTargetsReactionsCounters = this.targetsReactionsCounters.getAndRequireEquals();
    const initialTargetsReactionsCounters = proof.publicInput.initialTargetsReactionsCounters;
    currentTargetsReactionsCounters.assertEquals(initialTargetsReactionsCounters);

    const currentReactions = this.reactions.getAndRequireEquals();
    const initialReactions = proof.publicInput.initialReactions;
    currentReactions.assertEquals(initialReactions);

    const currentStateHistory = this.stateHistory.getAndRequireEquals();
    const [initialStateHistory, stateHistoryKey] = stateHistoryWitness.computeRootAndKeyV2(Field(0));
    currentStateHistory.assertEquals(initialStateHistory);
    blockHeightAsField.assertEquals(stateHistoryKey);

    const latestAllReactionsCounter = proof.publicInput.latestAllReactionsCounter;
    const latestUsersReactionsCounters = proof.publicInput.latestUsersReactionsCounters;
    const latestTargetsReactionsCounters = proof.publicInput.latestTargetsReactionsCounters;
    const latestReactions = proof.publicInput.latestReactions;

    const latestState = Poseidon.hash([
      latestAllReactionsCounter,
      latestUsersReactionsCounters,
      latestTargetsReactionsCounters,
      latestReactions
    ]);
    const latestStateHistory = stateHistoryWitness.computeRootAndKeyV2(latestState)[0];

    this.allReactionsCounter.set(latestAllReactionsCounter);
    this.usersReactionsCounters.set(latestUsersReactionsCounters);
    this.targetsReactionsCounters.set(latestTargetsReactionsCounters);
    this.reactions.set(latestReactions);
    this.lastUpdate.set(blockHeightAsField);
    this.stateHistory.set(latestStateHistory);
  }
}
