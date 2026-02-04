# UnlinkIdentityRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**IdentityId** | **string** | Identity ID to unlink | 
**Reason** | **string** | Reason for unlinking | 

## Methods

### NewUnlinkIdentityRequest

`func NewUnlinkIdentityRequest(identityId string, reason string, ) *UnlinkIdentityRequest`

NewUnlinkIdentityRequest instantiates a new UnlinkIdentityRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUnlinkIdentityRequestWithDefaults

`func NewUnlinkIdentityRequestWithDefaults() *UnlinkIdentityRequest`

NewUnlinkIdentityRequestWithDefaults instantiates a new UnlinkIdentityRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetIdentityId

`func (o *UnlinkIdentityRequest) GetIdentityId() string`

GetIdentityId returns the IdentityId field if non-nil, zero value otherwise.

### GetIdentityIdOk

`func (o *UnlinkIdentityRequest) GetIdentityIdOk() (*string, bool)`

GetIdentityIdOk returns a tuple with the IdentityId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdentityId

`func (o *UnlinkIdentityRequest) SetIdentityId(v string)`

SetIdentityId sets IdentityId field to given value.


### GetReason

`func (o *UnlinkIdentityRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *UnlinkIdentityRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *UnlinkIdentityRequest) SetReason(v string)`

SetReason sets Reason field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


