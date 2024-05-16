import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
  PublicKey,
  MerkleTree,
  MerkleWitness,
  Signature,
  Poseidon
} from 'o1js';
import { PostsTransition, PostsBlockProof } from './Posts.js';
import fs from 'fs/promises';
import { PostsContract } from './PostsContract.js';

export type Config = {
  deployAliases: Record<
    string,
    {
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};

// ============================================================================

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

const newMerkleTree = new MerkleTree(255);
const newMerkleTreeRoot = newMerkleTree.getRoot();
class MerkleWitness255 extends MerkleWitness(255) {}

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

export class PostsContractB extends SmartContract {
  @state(Field) allPostsCounter = State<Field>();
  @state(Field) usersPostsCounters = State<Field>();
  @state(Field) posts = State<Field>();
  @state(Field) postsBlockchain = State<Field>();

  init() {
    super.init();
    const postsContract = new PostsContract(postsContractAddress);

    const currentAllPostsCounter = postsContract.allPostsCounter.getAndRequireEquals();
    this.allPostsCounter.set(currentAllPostsCounter);
    
    const currentUsersPostsCounters = postsContract.usersPostsCounters.getAndRequireEquals();
    this.usersPostsCounters.set(currentUsersPostsCounters);

    const currentPosts = postsContract.posts.getAndRequireEquals();
    this.posts.set(currentPosts);

    const currentLastValidState = postsContract.lastValidState.getAndRequireEquals();
    this.postsBlockchain.set(currentLastValidState);
  }

  @method async proveBlockGapAndRollbackBlockchain(
    postsBlock1Hashed: Field,
    postsBlock2Hashed: Field,
    postsBlock3Hashed: Field,
    postsBlock1Witness: MerkleWitness255,
    postsBlock2Witness: MerkleWitness255,
    postsBlock3Witness: MerkleWitness255,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field,
    postsBlockchain: Field,
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const currentPostsBlockchain = postsContract.postsBlockchain.getAndRequireEquals();

    postsBlock1Hashed.assertNotEquals(Field(0));
    postsBlock2Hashed.assertEquals(Field(0));
    postsBlock3Hashed.assertNotEquals(Field(0));

    const postsBlock1WitnessRoot = postsBlock1Witness.calculateRoot(postsBlock1Hashed);
    const postsBlock2WitnessRoot = postsBlock2Witness.calculateRoot(postsBlock2Hashed);
    const postsBlock3WitnessRoot = postsBlock3Witness.calculateRoot(postsBlock3Hashed);
    postsBlock1WitnessRoot.assertEquals(postsBlock2WitnessRoot);
    postsBlock2WitnessRoot.assertEquals(postsBlock3WitnessRoot);
    postsBlock3WitnessRoot.assertEquals(currentPostsBlockchain);

    const postsBlock1WitnessIndex = postsBlock1Witness.calculateIndex();
    const postsBlock2WitnessIndex = postsBlock2Witness.calculateIndex();
    const postsBlock3WitnessIndex = postsBlock3Witness.calculateIndex();
    postsBlock2WitnessIndex.assertGreaterThan(postsBlock1WitnessIndex);
    postsBlock3WitnessIndex.assertGreaterThan(postsBlock2WitnessIndex);

    const currentLastValidState = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts, postsBlockchain]);
    lastValidState.assertEquals(currentLastValidState);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.postsBlockchain.set(postsBlockchain);
  }

  @method async provePostsTransitionBlockheightErrorAndRollback(
    postsBlock1Proof: PostsBlockProof,
    postsBlock2Proof: PostsBlockProof,
    postsBlock1Witness: MerkleWitness255,
    postsBlock2Witness: MerkleWitness255,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field,
    postsBlockchain: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const currentPostsBlockchain = postsContract.postsBlockchain.getAndRequireEquals();

    const postsBlock1WitnessRoot = postsBlock1Witness.calculateRoot(postsBlock1Proof.publicInput.postsBlockHash);
    const postsBlock2WitnessRoot = postsBlock2Witness.calculateRoot(postsBlock2Proof.publicInput.postsBlockHash);
    postsBlock1WitnessRoot.assertEquals(postsBlock2WitnessRoot);
    postsBlock1WitnessRoot.assertEquals(currentPostsBlockchain);

    const postsBlock1WitnessIndex = postsBlock1Witness.calculateIndex();
    const postsBlock2WitnessIndex = postsBlock2Witness.calculateIndex();
    postsBlock2WitnessIndex.assertEquals(postsBlock1WitnessIndex.add(1));

    postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.blockHeight.assertLessThan(
      postsBlock1Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.blockHeight
    );

    const currentLastValidState = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts, postsBlockchain]);
    lastValidState.assertEquals(currentLastValidState);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.postsBlockchain.set(postsBlockchain);
  }
}
