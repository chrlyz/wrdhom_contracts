import {
  Field,
  SmartContract,
  state,
  State,
  method,
  PublicKey,
  Poseidon,
  MerkleTree,
  MerkleWitness
} from 'o1js';
import { PostPublishingTransactionProof } from './Posts.js';
import { PostsContract, Config, postsContractAddress } from './PostsContract.js';
import fs from 'fs/promises';


// ============================================================================

const newMerkleTree = new MerkleTree(255);
class MerkleWitness255 extends MerkleWitness(255) {}

const configJson: Config = JSON.parse(
  await fs.readFile('config.json', 'utf8')
);
const postsSubcontractBConfig = configJson.deployAliases['postsSubcontractB'];
const postsSubcontractBConfigAddressBase58: { publicKey: string } = JSON.parse(
  await fs.readFile(postsSubcontractBConfig.keyPath, 'utf8')
);
export const postsSubcontractBAddress = PublicKey.fromBase58(
  postsSubcontractBConfigAddressBase58.publicKey
);

// ============================================================================

export class PostsSubcontractB extends SmartContract {
  @state(Field) allPostsCounter = State<Field>();
  @state(Field) usersPostsCounters = State<Field>();
  @state(Field) posts = State<Field>();
  @state(Field) lastValidState = State<Field>();

  init() {
    super.init();
    const postsContract = new PostsContract(postsContractAddress);

    const allPostsCounterCurrent = postsContract.allPostsCounter.getAndRequireEquals();
    this.allPostsCounter.set(allPostsCounterCurrent);
    
    const usersPostsCountersCurrent = postsContract.usersPostsCounters.getAndRequireEquals();
    this.usersPostsCounters.set(usersPostsCountersCurrent);

    const postsCurrent = postsContract.posts.getAndRequireEquals();
    this.posts.set(postsCurrent);

    const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
    this.lastValidState.set(lastValidStateCurrent);
  }

  @method async proveBlockGapAndRollbackBlockchain(
    postPublishingTransaction1Hashed: Field,
    postPublishingTransaction2Hashed: Field,
    postPublishingTransaction3Hashed: Field,
    postPublishingTransaction1Witness: MerkleWitness255,
    postPublishingTransaction2Witness: MerkleWitness255,
    postPublishingTransaction3Witness: MerkleWitness255,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const postsBatchCurrent = postsContract.postsBatch.getAndRequireEquals();

    postPublishingTransaction1Hashed.assertNotEquals(Field(0));
    postPublishingTransaction2Hashed.assertEquals(Field(0));
    postPublishingTransaction3Hashed.assertNotEquals(Field(0));

    const postPublishingTransaction1WitnessRoot = postPublishingTransaction1Witness.calculateRoot(postPublishingTransaction1Hashed);
    const postPublishingTransaction2WitnessRoot = postPublishingTransaction2Witness.calculateRoot(postPublishingTransaction2Hashed);
    const postPublishingTransaction3WitnessRoot = postPublishingTransaction3Witness.calculateRoot(postPublishingTransaction3Hashed);
    postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransaction2WitnessRoot);
    postPublishingTransaction2WitnessRoot.assertEquals(postPublishingTransaction3WitnessRoot);
    postPublishingTransaction3WitnessRoot.assertEquals(postsBatchCurrent);

    const postPublishingTransaction1WitnessIndex = postPublishingTransaction1Witness.calculateIndex();
    const postPublishingTransaction2WitnessIndex = postPublishingTransaction2Witness.calculateIndex();
    const postPublishingTransaction3WitnessIndex = postPublishingTransaction3Witness.calculateIndex();
    postPublishingTransaction2WitnessIndex.assertGreaterThan(postPublishingTransaction1WitnessIndex);
    postPublishingTransaction3WitnessIndex.assertGreaterThan(postPublishingTransaction2WitnessIndex);

    const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
    lastValidState.assertEquals(lastValidStateCurrent);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.lastValidState.set(lastValidStateCurrent);
  }

  @method async provePostsTransitionBlockheightErrorAndRollback(
    postPublishingTransaction1Proof: PostPublishingTransactionProof,
    postPublishingTransaction2Proof: PostPublishingTransactionProof,
    postPublishingTransaction1Witness: MerkleWitness255,
    postPublishingTransaction2Witness: MerkleWitness255,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const postsBatchCurrent = postsContract.postsBatch.getAndRequireEquals();

    const postPublishingTransaction1WitnessRoot = postPublishingTransaction1Witness.calculateRoot(postPublishingTransaction1Proof.publicInput.postPublishingTransactionHash);
    const postPublishingTransaction2WitnessRoot = postPublishingTransaction2Witness.calculateRoot(postPublishingTransaction2Proof.publicInput.postPublishingTransactionHash);
    postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransaction2WitnessRoot);
    postPublishingTransaction1WitnessRoot.assertEquals(postsBatchCurrent);

    const postPublishingTransaction1WitnessIndex = postPublishingTransaction1Witness.calculateIndex();
    const postPublishingTransaction2WitnessIndex = postPublishingTransaction2Witness.calculateIndex();
    postPublishingTransaction2WitnessIndex.assertEquals(postPublishingTransaction1WitnessIndex.add(1));

    postPublishingTransaction2Proof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.blockHeight.assertEquals(
      postPublishingTransaction1Proof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.blockHeight
    );

    const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
    lastValidState.assertEquals(lastValidStateCurrent);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.lastValidState.set(lastValidStateCurrent);
  }
}
