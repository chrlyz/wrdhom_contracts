import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
  PublicKey,
  Gadgets,
  Poseidon,
  MerkleMapWitness
} from 'o1js';
import { PostsProof } from './Posts.js';
import { Config } from './PostsDeploy';
import fs from 'fs/promises';

// ============================================================================

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

const postsConfigJson: Config = JSON.parse(
  await fs.readFile('config.json', 'utf8')
);
const postsConfig = postsConfigJson.deployAliases['posts'];
const postsContractAddressBase58: { publicKey: string } = JSON.parse(
  await fs.readFile(postsConfig.keyPath, 'utf8')
);
export const postsContractAddress = PublicKey.fromBase58(
  postsContractAddressBase58.publicKey
);

// ============================================================================

export class PostsContract extends SmartContract {
  @state(Field) allPostsCounter = State<Field>();
  @state(Field) usersPostsCounters = State<Field>();
  @state(Field) posts = State<Field>();
  @state(Field) lastUpdate = State<Field>();
  @state(Field) stateHistory = State<Field>();

  init() {
    super.init();
    this.allPostsCounter.set(Field(0));
    this.usersPostsCounters.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
    this.lastUpdate.set(Field(0));
    this.stateHistory.set(newMerkleMapRoot);
  }

  @method async update(proof: PostsProof, stateHistoryWitness: MerkleMapWitness) {
    proof.verify();

    Gadgets.rangeCheck32(proof.publicInput.blockHeight);
    const blockHeightAsField = proof.publicInput.blockHeight;
    const blockHeight = UInt32.Unsafe.fromField(proof.publicInput.blockHeight);
    this.network.blockchainLength.requireBetween(blockHeight,blockHeight.add(10));

    const currentAllPostsCounter = this.allPostsCounter.getAndRequireEquals();
    const initialAllPostsCounter = proof.publicInput.initialAllPostsCounter;
    currentAllPostsCounter.assertEquals(initialAllPostsCounter);

    const currentUsersPostsCounters = this.usersPostsCounters.getAndRequireEquals();
    const initialUserPostsCounter = proof.publicInput.initialUsersPostsCounters;
    currentUsersPostsCounters.assertEquals(initialUserPostsCounter);

    const currentPosts = this.posts.getAndRequireEquals();
    const initialPosts = proof.publicInput.initialPosts;
    currentPosts.assertEquals(initialPosts);

    const currentStateHistory = this.stateHistory.getAndRequireEquals();
    const [initialStateHistory, stateHistoryKey] = stateHistoryWitness.computeRootAndKeyV2(Field(0));
    currentStateHistory.assertEquals(initialStateHistory);
    blockHeightAsField.assertEquals(stateHistoryKey);

    const latestAllPostsCounter = proof.publicInput.latestAllPostsCounter;
    const latestUsersPostsCounters = proof.publicInput.latestUsersPostsCounters;
    const latestPosts = proof.publicInput.latestPosts;
    const latestState = Poseidon.hash([
      latestAllPostsCounter,
      latestUsersPostsCounters,
      latestPosts
    ]);
    const latestStateHistory = stateHistoryWitness.computeRootAndKeyV2(latestState)[0];

    this.allPostsCounter.set(latestAllPostsCounter);
    this.usersPostsCounters.set(latestUsersPostsCounters);
    this.posts.set(latestPosts);
    this.lastUpdate.set(blockHeightAsField);
    this.stateHistory.set(latestStateHistory);
  }
}
