import {
  Field,
  MerkleMap,
  Struct,
  MerkleMapWitness,
  PublicKey,
  Signature,
  Poseidon,
  Experimental,
  Provable,
  SelfProof,
} from 'snarkyjs';

// ============================================================================

export class PostState extends Struct({
  postNumber: Field,
  blockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash([this.postNumber, this.blockHeight]);
  }
}

// ============================================================================

const userPostsTree = new MerkleMap();
const userPostsRoot = userPostsTree.getRoot();

export class PostsTransition extends Struct({
  initialUsersRoot: Field,
  latestUsersRoot: Field,
  initialPostsNumber: Field,
  latestPostsNumber: Field,
  blockHeight: Field,
}) {
  static createPostsTransition(
    signature: Signature,

    initialUsersRoot: Field,
    latestUsersRoot: Field,
    userAddress: PublicKey,
    userWitness: MerkleMapWitness,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    hashedPost: Field,
    postWitness: MerkleMapWitness,

    initialPostsNumber: Field,
    postState: PostState
  ) {
    const isSigned = signature.verify(userAddress, [hashedPost]);
    isSigned.assertTrue();

    const zeroIfNewUser = Provable.if(
      initialPostsRoot.equals(userPostsRoot),
      Field(0),
      initialPostsRoot
    );

    const [usersRootBefore, userKey] =
      userWitness.computeRootAndKey(zeroIfNewUser);
    initialUsersRoot.assertEquals(usersRootBefore);
    Poseidon.hash(userAddress.toFields()).assertEquals(userKey);

    const [userPostsRootBefore, postkey] = postWitness.computeRootAndKey(
      Field(0)
    );
    initialPostsRoot.assertEquals(userPostsRootBefore);
    hashedPost.assertEquals(postkey);

    initialPostsNumber.add(Field(1)).assertEquals(postState.postNumber);
    const userPostsRootAfter = postWitness.computeRootAndKey(
      postState.hash()
    )[0];
    userPostsRootAfter.assertEquals(latestPostsRoot);

    const usersRootAfter = userWitness.computeRootAndKey(latestPostsRoot)[0];
    usersRootAfter.assertEquals(latestUsersRoot);

    return new PostsTransition({
      initialUsersRoot: initialUsersRoot,
      latestUsersRoot: latestUsersRoot,
      initialPostsNumber: initialPostsNumber,
      latestPostsNumber: postState.postNumber,
      blockHeight: postState.blockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialUsersRoot.assertEquals(transition2.initialUsersRoot);
    transition1.latestUsersRoot.assertEquals(transition2.latestUsersRoot);
    transition1.initialPostsNumber.assertEquals(transition2.initialPostsNumber);
    transition1.latestPostsNumber.assertEquals(transition2.latestPostsNumber);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestUsersRoot.assertEquals(transition2.initialUsersRoot);
    transition1.latestPostsNumber.assertEquals(transition2.initialPostsNumber);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialUsersRoot: transition1.initialUsersRoot,
      latestUsersRoot: transition2.latestUsersRoot,
      initialPostsNumber: transition1.initialPostsNumber,
      latestPostsNumber: transition2.latestPostsNumber,
      blockHeight: transition2.blockHeight,
    });
  }
}

// ============================================================================

export const PostsRollup = Experimental.ZkProgram({
  publicInput: PostsTransition,

  methods: {
    provePostsTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        PublicKey,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        PostState,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialUsersRoot: Field,
        latestUsersRoot: Field,
        userAddress: PublicKey,
        userWitness: MerkleMapWitness,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        hashedPost: Field,
        postWitness: MerkleMapWitness,
        initialPostsNumber: Field,
        postState: PostState
      ) {
        const computedTransition = PostsTransition.createPostsTransition(
          signature,
          initialUsersRoot,
          latestUsersRoot,
          userAddress,
          userWitness,
          initialPostsRoot,
          latestPostsRoot,
          hashedPost,
          postWitness,
          initialPostsNumber,
          postState
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },
    proveMergedPostsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostsTransitions: PostsTransition,
        postsTransition1Proof: SelfProof<PostsTransition, undefined>,
        postsTransition2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsTransition1Proof.verify();
        postsTransition2Proof.verify();

        postsTransition1Proof.publicInput.latestUsersRoot.assertEquals(
          postsTransition2Proof.publicInput.initialUsersRoot
        );
        postsTransition1Proof.publicInput.initialUsersRoot.assertEquals(
          mergedPostsTransitions.initialUsersRoot
        );
        postsTransition2Proof.publicInput.latestUsersRoot.assertEquals(
          mergedPostsTransitions.latestUsersRoot
        );

        postsTransition1Proof.publicInput.latestPostsNumber.assertEquals(
          postsTransition2Proof.publicInput.initialPostsNumber
        );
        postsTransition1Proof.publicInput.initialPostsNumber.assertEquals(
          mergedPostsTransitions.initialPostsNumber
        );
        postsTransition2Proof.publicInput.latestPostsNumber.assertEquals(
          mergedPostsTransitions.latestPostsNumber
        );

        postsTransition1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
        postsTransition2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
      },
    },
  },
});

export let PostsRollupProof_ = Experimental.ZkProgram.Proof(PostsRollup);
export class PostsRollupProof extends PostsRollupProof_ {}

// ============================================================================
