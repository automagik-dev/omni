# UnlinkIdentity200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**Identity** | [**GetPersonPresence200ResponseDataIdentitiesInner**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 

## Methods

### NewUnlinkIdentity200ResponseData

`func NewUnlinkIdentity200ResponseData(person SearchPersons200ResponseItemsInner, identity GetPersonPresence200ResponseDataIdentitiesInner, ) *UnlinkIdentity200ResponseData`

NewUnlinkIdentity200ResponseData instantiates a new UnlinkIdentity200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUnlinkIdentity200ResponseDataWithDefaults

`func NewUnlinkIdentity200ResponseDataWithDefaults() *UnlinkIdentity200ResponseData`

NewUnlinkIdentity200ResponseDataWithDefaults instantiates a new UnlinkIdentity200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPerson

`func (o *UnlinkIdentity200ResponseData) GetPerson() SearchPersons200ResponseItemsInner`

GetPerson returns the Person field if non-nil, zero value otherwise.

### GetPersonOk

`func (o *UnlinkIdentity200ResponseData) GetPersonOk() (*SearchPersons200ResponseItemsInner, bool)`

GetPersonOk returns a tuple with the Person field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPerson

`func (o *UnlinkIdentity200ResponseData) SetPerson(v SearchPersons200ResponseItemsInner)`

SetPerson sets Person field to given value.


### GetIdentity

`func (o *UnlinkIdentity200ResponseData) GetIdentity() GetPersonPresence200ResponseDataIdentitiesInner`

GetIdentity returns the Identity field if non-nil, zero value otherwise.

### GetIdentityOk

`func (o *UnlinkIdentity200ResponseData) GetIdentityOk() (*GetPersonPresence200ResponseDataIdentitiesInner, bool)`

GetIdentityOk returns a tuple with the Identity field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdentity

`func (o *UnlinkIdentity200ResponseData) SetIdentity(v GetPersonPresence200ResponseDataIdentitiesInner)`

SetIdentity sets Identity field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


