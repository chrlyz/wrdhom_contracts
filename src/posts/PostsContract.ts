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
  Gadgets
} from 'o1js';
import { PostsSubcontractA, postsSubcontractAAddress } from './PostsSubcontractA.js';
import { PostsSubcontractB, postsSubcontractBAddress } from './PostsSubcontractB.js'; 
import { PostPublishingTransactionProof } from './Posts.js';
import fs from 'fs/promises';

// ============================================================================

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

const newMerkleTree = new MerkleTree(255);
const newMerkleTreeRoot = newMerkleTree.getRoot();
class MerkleWitness255 extends MerkleWitness(255) {}

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

export const configJson: Config = JSON.parse(
  await fs.readFile('config.json', 'utf8')
);
const postsConfig = configJson.deployAliases['postsContract'];
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
  @state(Field) lastValidState = State<Field>();
  @state(Field) postsBatch = State<Field>();

  init() {
    super.init();
    this.allPostsCounter.set(Field(0));
    this.usersPostsCounters.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
    this.lastValidState.set(Field(0));
    this.postsBatch.set(newMerkleTreeRoot);
  }

  @method async updatePostsContractState(
    signature: Signature,
    postPublishingTransactionBatchPrimerProof: PostPublishingTransactionProof,
    postPublishingTransactionBatchPrimerWitness: MerkleWitness255,
    allPostsCounterUpdate: Field,
    usersPostsCountersUpdate: Field,
    postsUpdate: Field,
    postsBatchUpdate: Field
  ) {
    const isSignatureValid = signature.verify(postsContractAddress, [postsBatchUpdate]);
    isSignatureValid.assertTrue();

    postPublishingTransactionBatchPrimerWitness.calculateIndex().assertEquals(Field(0));

    const postPublishingTransactionBatchPrimerWitnessRoot = postPublishingTransactionBatchPrimerWitness.calculateRoot(postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransactionHash);
    postPublishingTransactionBatchPrimerWitnessRoot.assertEquals(postsBatchUpdate);

    postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.initialAllPostsCounter.assertEquals(
      this.allPostsCounter.getAndRequireEquals()
    );
    postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.initialUsersPostsCounters.assertEquals(
      this.usersPostsCounters.getAndRequireEquals()
    );
    postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.initialPosts.assertEquals(
      this.posts.getAndRequireEquals()
    );

    Gadgets.rangeCheck32(postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.blockHeight);
    this.network.blockchainLength.requireBetween(
      UInt32.Unsafe.fromField(postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.blockHeight),
      UInt32.Unsafe.fromField(postPublishingTransactionBatchPrimerProof.publicInput.postPublishingTransaction.createPostPublishingTransitionInputs.transition.blockHeight).add(1)
    );

    this.allPostsCounter.set(allPostsCounterUpdate);
    this.usersPostsCounters.set(usersPostsCountersUpdate);
    this.posts.set(postsUpdate);
    this.postsBatch.set(postsBatchUpdate);
  }

  @method async rollbackByPostsSubcontractA() {
    const postsSubcontractA = new PostsSubcontractA(postsSubcontractAAddress);

    postsSubcontractA.lastValidState.getAndRequireEquals().assertEquals(this.lastValidState.getAndRequireEquals());

    this.allPostsCounter.set(postsSubcontractA.allPostsCounter.getAndRequireEquals());
    this.usersPostsCounters.set(postsSubcontractA.usersPostsCounters.getAndRequireEquals());
    this.posts.set(postsSubcontractA.posts.getAndRequireEquals());
  }

  @method async rollbackByPostsSubcontractB() {
    const postsSubcontractB = new PostsSubcontractB(postsSubcontractBAddress);

    postsSubcontractB.lastValidState.getAndRequireEquals().assertEquals(this.lastValidState.getAndRequireEquals());

    this.allPostsCounter.set(postsSubcontractB.allPostsCounter.getAndRequireEquals());
    this.usersPostsCounters.set(postsSubcontractB.usersPostsCounters.getAndRequireEquals());
    this.posts.set(postsSubcontractB.posts.getAndRequireEquals());
  }
}
