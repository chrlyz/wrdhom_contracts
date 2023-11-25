import {
  Struct,
  CircuitString,
  PublicKey,
  Field,
  Poseidon,
  Signature,
  MerkleMapWitness,
  ZkProgram,
} from 'o1js';
import { PostState } from './Posts.js';

// ============================================================================

export class RepostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  reposterAddress: PublicKey,
  allRepostsCounter: Field,
  userRepostsCounter: Field,
  repostBlockHeight: Field,
  deletionBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.posterAddress
        .toFields()
        .concat(this.postContentID.hash())
        .concat(this.reposterAddress.toFields())
        .concat(
          this.allRepostsCounter,
          this.userRepostsCounter,
          this.repostBlockHeight,
          this.deletionBlockHeight
        )
    );
  }
}

// ============================================================================

export class RepostsTransition extends Struct({
  initialAllRepostsCounter: Field,
  latestAllRepostsCounter: Field,
  initialUsersRepostsCounters: Field,
  latestUsersRepostsCounters: Field,
  posts: Field,
  initialReposts: Field,
  latestReposts: Field,
  blockHeight: Field,
}) {
  static createRepostTransition(
    signature: Signature,
    initialAllRepostsCounter: Field,
    initialUserRepostsCounter: Field,
    initialUsersRepostsCounters: Field,
    latestUsersRepostsCounters: Field,
    userRepostsCounterWitness: MerkleMapWitness,
    posts: Field,
    postState: PostState,
    postWitness: MerkleMapWitness,
    initialReposts: Field,
    latestReposts: Field,
    repostState: RepostState,
    repostWitness: MerkleMapWitness
  ) {
    // Assure proper values for post being reposted
    repostState.posterAddress.assertEquals(postState.posterAddress);
    repostState.postContentID.assertEquals(postState.postContentID);
    // Assure global reposts ordering
    repostState.allRepostsCounter.sub(1).assertEquals(initialAllRepostsCounter);
    // Assure that a new repost isn't created flagged as deleted
    repostState.deletionBlockHeight.assertEquals(Field(0));
    // Assure that a deleted post can't be reposted
    postState.deletionBlockHeight.assertEquals(Field(0));

    // Verify that counter for reposter's reposts is valid to assure local reposts ordering
    const [usersRepostsCountersBefore, userRepostsCounterKey] =
      userRepostsCounterWitness.computeRootAndKey(initialUserRepostsCounter);
    usersRepostsCountersBefore.assertEquals(initialUsersRepostsCounters);
    initialUserRepostsCounter.assertEquals(
      repostState.userRepostsCounter.sub(1)
    );
    const reposterAddressAsField = Poseidon.hash(
      repostState.reposterAddress.toFields()
    );
    userRepostsCounterKey.assertEquals(reposterAddressAsField);

    // Update counter for reposter's reposts
    const usersRepostsCountersAfter =
      userRepostsCounterWitness.computeRootAndKey(
        repostState.userRepostsCounter
      )[0];
    usersRepostsCountersAfter.assertEquals(latestUsersRepostsCounters);

    // Verify reposter signature for repost
    const posterAddressAsField = Poseidon.hash(
      postState.posterAddress.toFields()
    );
    const postContentIDHash = postState.postContentID.hash();
    const isSigned = signature.verify(repostState.reposterAddress, [
      posterAddressAsField,
      postContentIDHash,
      repostState.userRepostsCounter,
    ]);
    isSigned.assertTrue();

    // Verify that the post being reposted exists
    const postsFromWitness = postWitness.computeRootAndKey(postState.hash())[0];
    postsFromWitness.assertEquals(posts);

    // Verify that initial root for reposts is valid
    const [repostsBefore, repostKey] = repostWitness.computeRootAndKey(
      Field(0)
    );
    repostsBefore.assertEquals(initialReposts);
    repostKey.assertEquals(
      Poseidon.hash([
        reposterAddressAsField,
        posterAddressAsField,
        postContentIDHash,
        repostState.userRepostsCounter,
      ])
    );

    // Update initial root with new repost state
    const repostsAfter = repostWitness.computeRootAndKey(repostState.hash())[0];
    repostsAfter.assertEquals(latestReposts);

    return new RepostsTransition({
      initialAllRepostsCounter: initialAllRepostsCounter,
      latestAllRepostsCounter: repostState.allRepostsCounter,
      initialUsersRepostsCounters: usersRepostsCountersBefore,
      latestUsersRepostsCounters: usersRepostsCountersAfter,
      posts: postsFromWitness,
      initialReposts: repostsBefore,
      latestReposts: repostsAfter,
      blockHeight: repostState.repostBlockHeight,
    });
  }

  static assertEquals(
    transition1: RepostsTransition,
    transition2: RepostsTransition
  ) {
    transition1.initialAllRepostsCounter.assertEquals(
      transition2.initialAllRepostsCounter
    );
    transition1.latestAllRepostsCounter.assertEquals(
      transition2.latestAllRepostsCounter
    );
    transition1.initialUsersRepostsCounters.assertEquals(
      transition2.initialUsersRepostsCounters
    );
    transition1.latestUsersRepostsCounters.assertEquals(
      transition2.latestUsersRepostsCounters
    );
    transition1.posts.assertEquals(transition2.posts);
    transition1.initialReposts.assertEquals(transition2.initialReposts);
    transition1.latestReposts.assertEquals(transition2.latestReposts);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }
}

// ============================================================================

export const Reposts = ZkProgram({
  name: 'Reposts',
  publicInput: RepostsTransition,

  methods: {
    proveRepostTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        RepostState,
        MerkleMapWitness,
      ],

      method(
        transition: RepostsTransition,
        signature: Signature,
        initialAllRepostsCounter: Field,
        initialUserRepostsCounter: Field,
        initialUsersRepostsCounters: Field,
        latestUsersRepostsCounters: Field,
        userRepostsCounterWitness: MerkleMapWitness,
        posts: Field,
        postState: PostState,
        postWitness: MerkleMapWitness,
        initialReposts: Field,
        latestReposts: Field,
        repostState: RepostState,
        repostWitness: MerkleMapWitness
      ) {
        const computedTransition = RepostsTransition.createRepostTransition(
          signature,
          initialAllRepostsCounter,
          initialUserRepostsCounter,
          initialUsersRepostsCounters,
          latestUsersRepostsCounters,
          userRepostsCounterWitness,
          posts,
          postState,
          postWitness,
          initialReposts,
          latestReposts,
          repostState,
          repostWitness
        );
        RepostsTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let RepostsProof_ = ZkProgram.Proof(Reposts);
export class RepostsProof extends RepostsProof_ {}

// ============================================================================
