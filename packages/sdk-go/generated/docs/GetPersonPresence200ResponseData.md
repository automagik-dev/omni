# GetPersonPresence200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**Identities** | [**[]GetPersonPresence200ResponseDataIdentitiesInner**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**Summary** | [**GetPersonPresence200ResponseDataSummary**](GetPersonPresence200ResponseDataSummary.md) |  | 
**ByChannel** | [**map[string]GetPersonPresence200ResponseDataByChannelValue**](GetPersonPresence200ResponseDataByChannelValue.md) |  | 

## Methods

### NewGetPersonPresence200ResponseData

`func NewGetPersonPresence200ResponseData(person SearchPersons200ResponseItemsInner, identities []GetPersonPresence200ResponseDataIdentitiesInner, summary GetPersonPresence200ResponseDataSummary, byChannel map[string]GetPersonPresence200ResponseDataByChannelValue, ) *GetPersonPresence200ResponseData`

NewGetPersonPresence200ResponseData instantiates a new GetPersonPresence200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonPresence200ResponseDataWithDefaults

`func NewGetPersonPresence200ResponseDataWithDefaults() *GetPersonPresence200ResponseData`

NewGetPersonPresence200ResponseDataWithDefaults instantiates a new GetPersonPresence200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPerson

`func (o *GetPersonPresence200ResponseData) GetPerson() SearchPersons200ResponseItemsInner`

GetPerson returns the Person field if non-nil, zero value otherwise.

### GetPersonOk

`func (o *GetPersonPresence200ResponseData) GetPersonOk() (*SearchPersons200ResponseItemsInner, bool)`

GetPersonOk returns a tuple with the Person field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPerson

`func (o *GetPersonPresence200ResponseData) SetPerson(v SearchPersons200ResponseItemsInner)`

SetPerson sets Person field to given value.


### GetIdentities

`func (o *GetPersonPresence200ResponseData) GetIdentities() []GetPersonPresence200ResponseDataIdentitiesInner`

GetIdentities returns the Identities field if non-nil, zero value otherwise.

### GetIdentitiesOk

`func (o *GetPersonPresence200ResponseData) GetIdentitiesOk() (*[]GetPersonPresence200ResponseDataIdentitiesInner, bool)`

GetIdentitiesOk returns a tuple with the Identities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdentities

`func (o *GetPersonPresence200ResponseData) SetIdentities(v []GetPersonPresence200ResponseDataIdentitiesInner)`

SetIdentities sets Identities field to given value.


### GetSummary

`func (o *GetPersonPresence200ResponseData) GetSummary() GetPersonPresence200ResponseDataSummary`

GetSummary returns the Summary field if non-nil, zero value otherwise.

### GetSummaryOk

`func (o *GetPersonPresence200ResponseData) GetSummaryOk() (*GetPersonPresence200ResponseDataSummary, bool)`

GetSummaryOk returns a tuple with the Summary field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSummary

`func (o *GetPersonPresence200ResponseData) SetSummary(v GetPersonPresence200ResponseDataSummary)`

SetSummary sets Summary field to given value.


### GetByChannel

`func (o *GetPersonPresence200ResponseData) GetByChannel() map[string]GetPersonPresence200ResponseDataByChannelValue`

GetByChannel returns the ByChannel field if non-nil, zero value otherwise.

### GetByChannelOk

`func (o *GetPersonPresence200ResponseData) GetByChannelOk() (*map[string]GetPersonPresence200ResponseDataByChannelValue, bool)`

GetByChannelOk returns a tuple with the ByChannel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByChannel

`func (o *GetPersonPresence200ResponseData) SetByChannel(v map[string]GetPersonPresence200ResponseDataByChannelValue)`

SetByChannel sets ByChannel field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


