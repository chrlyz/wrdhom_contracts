import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
  PublicKey,
} from 'o1js';
import { PostsProof } from './Posts.js';
import { Config } from './PostsDeploy';
import fs from 'fs/promises';

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

export class PostsContract extends SmartContract {
  @state(Field) allPostsCounter = State<Field>();
  @state(Field) usersPostsCounters = State<Field>();
  @state(Field) posts = State<Field>();

  init() {
    super.init();
    this.allPostsCounter.set(Field(0));
    this.usersPostsCounters.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
  }

  @method update(proof: PostsProof) {
    proof.verify();

    this.network.blockchainLength.assertBetween(
      UInt32.from(proof.publicInput.blockHeight),
      UInt32.from(proof.publicInput.blockHeight).add(1)
    );

    const currentAllPostsCounter = this.allPostsCounter.getAndAssertEquals();
    proof.publicInput.initialAllPostsCounter.assertEquals(
      currentAllPostsCounter
    );

    const currentUsersPostsCounters =
      this.usersPostsCounters.getAndAssertEquals();
    proof.publicInput.initialUsersPostsCounters.assertEquals(
      currentUsersPostsCounters
    );

    const currentState = this.posts.getAndAssertEquals();
    proof.publicInput.initialPosts.assertEquals(currentState);

    this.posts.set(proof.publicInput.latestPosts);
    this.allPostsCounter.set(proof.publicInput.latestAllPostsCounter);
    this.usersPostsCounters.set(proof.publicInput.latestUsersPostsCounters);
  }
}
