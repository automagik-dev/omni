# GetPersonTimelineById200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | **[]interface{}** |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Methods

### NewGetPersonTimelineById200Response

`func NewGetPersonTimelineById200Response(items []*interface{}, meta ListInstances200ResponseMeta, ) *GetPersonTimelineById200Response`

NewGetPersonTimelineById200Response instantiates a new GetPersonTimelineById200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonTimelineById200ResponseWithDefaults

`func NewGetPersonTimelineById200ResponseWithDefaults() *GetPersonTimelineById200Response`

NewGetPersonTimelineById200ResponseWithDefaults instantiates a new GetPersonTimelineById200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *GetPersonTimelineById200Response) GetItems() []*interface{}`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *GetPersonTimelineById200Response) GetItemsOk() (*[]*interface{}, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *GetPersonTimelineById200Response) SetItems(v []*interface{})`

SetItems sets Items field to given value.


### GetMeta

`func (o *GetPersonTimelineById200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *GetPersonTimelineById200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *GetPersonTimelineById200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


