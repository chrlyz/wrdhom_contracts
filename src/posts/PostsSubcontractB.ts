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

  @method async provePostPublishingTransactionsMissingAndRollback(
    postPublishingTransactionHashed: Field,
    postPublishingTransactionWitness: MerkleWitness256,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field
  ) {
    const postsContract = new PostsContract(postsContractAddress);
    const postPublishingTransactionsCurrent = postsContract.postPublishingTransactions.getAndRequireEquals();

    postPublishingTransactionHashed.assertEquals(Field(0));

    const postPublishingTransactionWitnessRoot = postPublishingTransactionWitness.calculateRoot(postPublishingTransactionHashed);
    postPublishingTransactionWitnessRoot.assertEquals(postPublishingTransactionsCurrent);

    const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
    lastValidState.assertEquals(lastValidStateCurrent);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.lastValidState.set(lastValidStateCurrent);
  }

  @method async provePostPublishingBlockHeightErrorAndRollback(
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

    postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.blockHeight.assertNotEquals(
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
