# PersonPresence

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**Identities** | [**[]GetPersonPresence200ResponseDataIdentitiesInner**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**Summary** | [**GetPersonPresence200ResponseDataSummary**](GetPersonPresence200ResponseDataSummary.md) |  | 
**ByChannel** | [**map[string]GetPersonPresence200ResponseDataByChannelValue**](GetPersonPresence200ResponseDataByChannelValue.md) |  | 

## Methods

### NewPersonPresence

`func NewPersonPresence(person SearchPersons200ResponseItemsInner, identities []GetPersonPresence200ResponseDataIdentitiesInner, summary GetPersonPresence200ResponseDataSummary, byChannel map[string]GetPersonPresence200ResponseDataByChannelValue, ) *PersonPresence`

NewPersonPresence instantiates a new PersonPresence object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPersonPresenceWithDefaults

`func NewPersonPresenceWithDefaults() *PersonPresence`

NewPersonPresenceWithDefaults instantiates a new PersonPresence object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPerson

`func (o *PersonPresence) GetPerson() SearchPersons200ResponseItemsInner`

GetPerson returns the Person field if non-nil, zero value otherwise.

### GetPersonOk

`func (o *PersonPresence) GetPersonOk() (*SearchPersons200ResponseItemsInner, bool)`

GetPersonOk returns a tuple with the Person field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPerson

`func (o *PersonPresence) SetPerson(v SearchPersons200ResponseItemsInner)`

SetPerson sets Person field to given value.


### GetIdentities

`func (o *PersonPresence) GetIdentities() []GetPersonPresence200ResponseDataIdentitiesInner`

GetIdentities returns the Identities field if non-nil, zero value otherwise.

### GetIdentitiesOk

`func (o *PersonPresence) GetIdentitiesOk() (*[]GetPersonPresence200ResponseDataIdentitiesInner, bool)`

GetIdentitiesOk returns a tuple with the Identities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdentities

`func (o *PersonPresence) SetIdentities(v []GetPersonPresence200ResponseDataIdentitiesInner)`

SetIdentities sets Identities field to given value.


### GetSummary

`func (o *PersonPresence) GetSummary() GetPersonPresence200ResponseDataSummary`

GetSummary returns the Summary field if non-nil, zero value otherwise.

### GetSummaryOk

`func (o *PersonPresence) GetSummaryOk() (*GetPersonPresence200ResponseDataSummary, bool)`

GetSummaryOk returns a tuple with the Summary field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSummary

`func (o *PersonPresence) SetSummary(v GetPersonPresence200ResponseDataSummary)`

SetSummary sets Summary field to given value.


### GetByChannel

`func (o *PersonPresence) GetByChannel() map[string]GetPersonPresence200ResponseDataByChannelValue`

GetByChannel returns the ByChannel field if non-nil, zero value otherwise.

### GetByChannelOk

`func (o *PersonPresence) GetByChannelOk() (*map[string]GetPersonPresence200ResponseDataByChannelValue, bool)`

GetByChannelOk returns a tuple with the ByChannel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByChannel

`func (o *PersonPresence) SetByChannel(v map[string]GetPersonPresence200ResponseDataByChannelValue)`

SetByChannel sets ByChannel field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


