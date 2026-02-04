# GetPersonTimeline200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**person_id** | **UUID** |  | 
**items** | [**List[ListEvents200ResponseItemsInner]**](ListEvents200ResponseItemsInner.md) |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.get_person_timeline200_response import GetPersonTimeline200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonTimeline200Response from a JSON string
get_person_timeline200_response_instance = GetPersonTimeline200Response.from_json(json)
# print the JSON string representation of the object
print(GetPersonTimeline200Response.to_json())

# convert the object into a dict
get_person_timeline200_response_dict = get_person_timeline200_response_instance.to_dict()
# create an instance of GetPersonTimeline200Response from a dict
get_person_timeline200_response_from_dict = GetPersonTimeline200Response.from_dict(get_person_timeline200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


