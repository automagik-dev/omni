# GetPersonTimeline200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PersonId** | **string** |  | 
**Items** | [**[]ListEvents200ResponseItemsInner**](ListEvents200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Methods

### NewGetPersonTimeline200Response

`func NewGetPersonTimeline200Response(personId string, items []ListEvents200ResponseItemsInner, meta ListInstances200ResponseMeta, ) *GetPersonTimeline200Response`

NewGetPersonTimeline200Response instantiates a new GetPersonTimeline200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonTimeline200ResponseWithDefaults

`func NewGetPersonTimeline200ResponseWithDefaults() *GetPersonTimeline200Response`

NewGetPersonTimeline200ResponseWithDefaults instantiates a new GetPersonTimeline200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPersonId

`func (o *GetPersonTimeline200Response) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *GetPersonTimeline200Response) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *GetPersonTimeline200Response) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### GetItems

`func (o *GetPersonTimeline200Response) GetItems() []ListEvents200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *GetPersonTimeline200Response) GetItemsOk() (*[]ListEvents200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *GetPersonTimeline200Response) SetItems(v []ListEvents200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *GetPersonTimeline200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *GetPersonTimeline200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *GetPersonTimeline200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


