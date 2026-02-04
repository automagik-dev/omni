# GetPersonTimelineById200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | **List[Optional[object]]** |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.get_person_timeline_by_id200_response import GetPersonTimelineById200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonTimelineById200Response from a JSON string
get_person_timeline_by_id200_response_instance = GetPersonTimelineById200Response.from_json(json)
# print the JSON string representation of the object
print(GetPersonTimelineById200Response.to_json())

# convert the object into a dict
get_person_timeline_by_id200_response_dict = get_person_timeline_by_id200_response_instance.to_dict()
# create an instance of GetPersonTimelineById200Response from a dict
get_person_timeline_by_id200_response_from_dict = GetPersonTimelineById200Response.from_dict(get_person_timeline_by_id200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


