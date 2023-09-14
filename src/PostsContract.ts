import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
} from 'o1js';
import { PostsProof } from './Posts';

const newMerkleMap = new MerkleMap();
const newMerkleMapRoot = newMerkleMap.getRoot();

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

    this.currentSlot.assertBetween(
      UInt32.from(proof.publicInput.slot.sub(Field(1))),
      UInt32.from(proof.publicInput.slot.add(Field(1)))
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
