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

const newMerkleTree = new MerkleTree(256);
class MerkleWitness256 extends MerkleWitness(256) {}

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

  @method async provePostTransactionsGapAndRollbackBlockchain(
    postTransaction1Hashed: Field,
    postTransaction2Hashed: Field,
    postTransaction3Hashed: Field,
    postTransaction1Witness: MerkleWitness256,
    postTransaction2Witness: MerkleWitness256,
    postTransaction3Witness: MerkleWitness256,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const postPublishingTransactionsCurrent = postsContract.postPublishingTransactions.getAndRequireEquals();

    postTransaction1Hashed.assertNotEquals(Field(0));
    postTransaction2Hashed.assertEquals(Field(0));
    postTransaction3Hashed.assertNotEquals(Field(0));

    const postTransaction1WitnessRoot = postTransaction1Witness.calculateRoot(postTransaction1Hashed);
    const postTransaction2WitnessRoot = postTransaction2Witness.calculateRoot(postTransaction2Hashed);
    const postTransaction3WitnessRoot = postTransaction3Witness.calculateRoot(postTransaction3Hashed);
    postTransaction1WitnessRoot.assertEquals(postTransaction2WitnessRoot);
    postTransaction2WitnessRoot.assertEquals(postTransaction3WitnessRoot);
    postTransaction3WitnessRoot.assertEquals(postPublishingTransactionsCurrent);

    const postTransaction1WitnessIndex = postTransaction1Witness.calculateIndex();
    const postTransaction2WitnessIndex = postTransaction2Witness.calculateIndex();
    const postTransaction3WitnessIndex = postTransaction3Witness.calculateIndex();
    postTransaction2WitnessIndex.assertGreaterThan(postTransaction1WitnessIndex);
    postTransaction3WitnessIndex.assertGreaterThan(postTransaction2WitnessIndex);

    const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
    lastValidState.assertEquals(lastValidStateCurrent);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.lastValidState.set(lastValidStateCurrent);
  }

  @method async provePostPublishingBlockheightErrorAndRollback(
    postPublishingTransaction1Proof: PostPublishingTransactionProof,
    postPublishingTransaction2Proof: PostPublishingTransactionProof,
    postPublishingTransaction1Witness: MerkleWitness256,
    postPublishingTransaction2Witness: MerkleWitness256,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const postPublishingTransactionsCurrent = postsContract.postPublishingTransactions.getAndRequireEquals();

    const postPublishingTransaction1WitnessRoot = postPublishingTransaction1Witness.calculateRoot(postPublishingTransaction1Proof.publicInput.postPublishingTransactionHash);
    const postPublishingTransaction2WitnessRoot = postPublishingTransaction2Witness.calculateRoot(postPublishingTransaction2Proof.publicInput.postPublishingTransactionHash);
    postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransaction2WitnessRoot);
    postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransactionsCurrent);

    const postPublishingTransaction1WitnessIndex = postPublishingTransaction1Witness.calculateIndex();
    const postPublishingTransaction2WitnessIndex = postPublishingTransaction2Witness.calculateIndex();
    postPublishingTransaction2WitnessIndex.assertEquals(postPublishingTransaction1WitnessIndex.add(1));

    postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.blockHeight.assertEquals(
      postPublishingTransaction1Proof.publicInput.postPublishingTransaction.transition.blockHeight
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
