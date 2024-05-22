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
  Gadgets,
  Poseidon
} from 'o1js';
import { PostsSubcontractA, postsSubcontractAAddress } from './PostsSubcontractA.js';
import { PostsSubcontractB, postsSubcontractBAddress } from './PostsSubcontractB.js'; 
import { PostPublishingTransactionProof } from './Posts.js';
import fs from 'fs/promises';

// ============================================================================

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

const newMerkleTree = new MerkleTree(256);
const newMerkleTreeRoot = newMerkleTree.getRoot();
class MerkleWitness256 extends MerkleWitness(256) {}

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
  @state(Field) lastUpdateBlockHeight = State<Field>();
  @state(Field) lastValidState = State<Field>();
  @state(Field) postPublishingTransactions = State<Field>();

  init() {
    super.init();
    this.allPostsCounter.set(Field(0));
    this.usersPostsCounters.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
    this.lastUpdateBlockHeight.set(Field(0));
    this.lastValidState.set(Field(0));
    this.postPublishingTransactions.set(newMerkleTreeRoot);
  }

  @method async applyPostPublishingTransactions(
    signature: Signature,
    postPublishingTransactionsPrimerProof: PostPublishingTransactionProof,
    postPublishingTransactionsPrimerWitness: MerkleWitness256,
    allPostsCounterUpdate: Field,
    usersPostsCountersUpdate: Field,
    postsUpdate: Field,
    postPublishingTransactionsUpdate: Field
  ) {
    this.network.blockchainLength.getAndRequireEquals().value.assertGreaterThan(
      this.lastUpdateBlockHeight.getAndRequireEquals().add(3)
    );

    const isSignatureValid = signature.verify(postsContractAddress, [postPublishingTransactionsUpdate]);
    isSignatureValid.assertTrue();

    postPublishingTransactionsPrimerWitness.calculateIndex().assertEquals(Field(0));

    const postPublishingTransactionsPrimerWitnessRoot = postPublishingTransactionsPrimerWitness.calculateRoot(postPublishingTransactionsPrimerProof.publicInput.postPublishingTransactionHash);
    postPublishingTransactionsPrimerWitnessRoot.assertEquals(postPublishingTransactionsUpdate);

    postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.initialAllPostsCounter.assertEquals(
      this.allPostsCounter.getAndRequireEquals()
    );
    postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.initialUsersPostsCounters.assertEquals(
      this.usersPostsCounters.getAndRequireEquals()
    );
    postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.initialPosts.assertEquals(
      this.posts.getAndRequireEquals()
    );

    Gadgets.rangeCheck32(postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.blockHeight);
    this.network.blockchainLength.requireBetween(
      UInt32.Unsafe.fromField(postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.blockHeight),
      UInt32.Unsafe.fromField(postPublishingTransactionsPrimerProof.publicInput.postPublishingTransaction.transition.blockHeight)
    );

    this.allPostsCounter.set(allPostsCounterUpdate);
    this.usersPostsCounters.set(usersPostsCountersUpdate);
    this.posts.set(postsUpdate);
    this.lastUpdateBlockHeight.set(this.network.blockchainLength.getAndRequireEquals().value);
    this.postPublishingTransactions.set(postPublishingTransactionsUpdate);
  }

  @method async setLastValidState() {
    this.network.blockchainLength.getAndRequireEquals().value.assertGreaterThan(
      this.lastUpdateBlockHeight.getAndRequireEquals().add(2)
    );

    const allPostsCounterCurrent = this.allPostsCounter.getAndRequireEquals();
    const usersPostsCountersCurrent = this.usersPostsCounters.getAndRequireEquals();
    const postsCurrent = this.posts.getAndRequireEquals();
    const postPublishingTransactionsCurrent = this.postPublishingTransactions.getAndRequireEquals();

    const lastValidState = Poseidon.hash([
      allPostsCounterCurrent,
      usersPostsCountersCurrent,
      postsCurrent,
      postPublishingTransactionsCurrent
    ]);

    this.lastValidState.set(lastValidState);
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
