import {
  Field,
  SmartContract,
  state,
  State,
  method,
  MerkleMap,
  UInt32,
} from 'snarkyjs';
import { PostsRollupProof } from './Posts';

const postsTree = new MerkleMap();
const postsRoot = postsTree.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) posts = State<Field>();
  @state(Field) postsNumber = State<Field>();

  init() {
    super.init();
    this.posts.set(postsRoot);
    this.postsNumber.set(Field(0));
  }

  @method update(rollupProof: PostsRollupProof) {
    rollupProof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(rollupProof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(rollupProof.publicInput.blockHeight.add(Field(1)))
    );

    const currentState = this.posts.getAndAssertEquals();
    rollupProof.publicInput.initialUsersRoot.assertEquals(currentState);

    const currentPostsNumber = this.postsNumber.getAndAssertEquals();
    rollupProof.publicInput.initialPostsNumber.assertEquals(currentPostsNumber);

    this.posts.set(rollupProof.publicInput.latestUsersRoot);
    this.postsNumber.set(rollupProof.publicInput.latestPostsNumber);
  }
}
